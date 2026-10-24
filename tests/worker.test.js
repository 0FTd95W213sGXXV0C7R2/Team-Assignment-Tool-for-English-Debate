
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Script } from 'node:vm';
import worker, {
  validateRow,
  validBackupKey,
  adminAllowed,
  backup
} from '../worker.js';

const SECRET = 'admin-secret-'.repeat(4);

const baseEnv = () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'TEST-SERVICE-ROLE-SECRET',
  RATE_SALT: 'TEST-SALT',
  ADMIN_PASSWORD: SECRET,
  ASSETS: { fetch: () => new Response('static') }
});

const req = (path, opts = {}) =>
  new Request(`https://debate.example${path}`, opts);

const dbResponse = value =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });

// All external services are mocked.
// No real Supabase or Cloudflare R2 data is accessed.

test('input validation and backup key validation', () => {
  assert.deepEqual(
    validateRow({
      motion: ' THW test ',
      tournament: ' HPDU ',
      year: '',
      history: []
    }),
    {
      motion: 'THW test',
      tournament: 'HPDU',
      year: '',
      history: []
    }
  );

  assert.throws(() =>
    validateRow({
      motion: '',
      tournament: 'HPDU',
      year: '',
      history: []
    })
  );

  assert.throws(() =>
    validateRow({
      motion: 'test',
      tournament: 'HPDU',
      year: '',
      history: ['not a date']
    })
  );

  assert.equal(
    validBackupKey(
      'snapshots/2026-10-24T18-00-00-000Z_daily.json'
    ),
    true
  );

  assert.equal(
    validBackupKey('../../admin.json'),
    false
  );
});

test('admin password is required and compared correctly', async () => {
  const env = baseEnv();

  assert.equal(
    await adminAllowed(req('/api/admin/audit'), env),
    false
  );

  assert.equal(
    await adminAllowed(
      req('/api/admin/audit', {
        headers: { 'x-admin-password': SECRET }
      }),
      env
    ),
    true
  );

  assert.equal(
    await adminAllowed(
      req('/api/admin/audit', {
        headers: { 'x-admin-password': SECRET + 'x' }
      }),
      env
    ),
    false
  );
});

test('GET returns only active motions with revisions', async () => {
  const old = globalThis.fetch;

  globalThis.fetch = async () =>
    dbResponse([
      {
        id: 'motion-0001',
        motion: 'A',
        revision: 0,
        is_deleted: false
      },
      {
        id: 'motion-0002',
        motion: 'B',
        revision: 1,
        is_deleted: true
      }
    ]);

  try {
    const res = await worker.fetch(
      req('/api/motions'),
      baseEnv()
    );

    assert.equal(res.status, 200);

    assert.deepEqual(
      (await res.json()).rows,
      [
        {
          id: 'motion-0001',
          motion: 'A',
          revision: 0
        }
      ]
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('anonymous edits call only server-side Supabase RPC and send revision', async () => {
  const old = globalThis.fetch;
  let captured;

  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return dbResponse({
      id: 'motion-0001',
      revision: 2
    });
  };

  try {
    const res = await worker.fetch(
      req('/api/mutate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.10'
        },
        body: JSON.stringify({
          action: 'update',
          id: 'motion-0001',
          expected_revision: 1,
          row: {
            motion: 'New',
            tournament: 'HPDU',
            year: '2026',
            history: []
          }
        })
      }),
      baseEnv()
    );

    assert.equal(res.status, 200);
    assert.match(captured.url, /rpc\/motion_apply$/);

    assert.equal(
      captured.init.headers.apikey,
      'TEST-SERVICE-ROLE-SECRET'
    );

    const sent = JSON.parse(captured.init.body);

    assert.equal(sent.p_expected_revision, 1);
    assert.equal(sent.p_client_hash.length, 64);
    assert.equal(sent.p_row.motion, 'New');
  } finally {
    globalThis.fetch = old;
  }
});

test('rejects cross-site POST and malformed mutation', async () => {
  const env = baseEnv();

  const wrongOrigin = await worker.fetch(
    req('/api/mutate', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json'
      },
      body: '{}'
    }),
    env
  );

  assert.equal(wrongOrigin.status, 403);

  const invalid = await worker.fetch(
    req('/api/mutate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        action: 'delete',
        id: 'bad id'
      })
    }),
    env
  );

  assert.equal(invalid.status, 400);
});

test('anonymous users cannot access trash or backups', async () => {
  const env = baseEnv();

  assert.equal(
    (await worker.fetch(
      req('/api/admin/deleted'),
      env
    )).status,
    403
  );

  assert.equal(
    (await worker.fetch(
      req('/api/admin/backups'),
      env
    )).status,
    403
  );
});

test('R2 backup includes all rows and audit and refuses empty snapshot', async () => {
  const old = globalThis.fetch;
  const stored = [];
  const env = baseEnv();

  env.BACKUPS = {
    put: async (key, value) =>
      stored.push({ key, value })
  };

  globalThis.fetch = async url => {
    if (url.includes('/motions?')) {
      return dbResponse([
        {
          id: 'motion-0001',
          motion: 'A',
          history: [],
          is_deleted: false,
          revision: 0
        }
      ]);
    }

    if (url.includes('/motion_audit?')) {
      return dbResponse([
        {
          audit_id: 1,
          action: 'INSERT'
        }
      ]);
    }

    throw Error('unexpected URL');
  };

  try {
    const result = await backup(env, 'daily');

    assert.equal(result.count, 1);
    assert.equal(result.audit_count, 1);
    assert.equal(stored.length, 1);

    const saved = JSON.parse(stored[0].value);

    assert.equal(saved.schema_version, 2);
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.audit.length, 1);

    globalThis.fetch = async () =>
      dbResponse([]);

    await assert.rejects(
      () => backup(env, 'daily'),
      /EMPTY_SNAPSHOT_REFUSED/
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('UI contains no Supabase key and inline JavaScript parses', () => {
  const html = fs.readFileSync(
    new URL('../public/index.html', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    html,
    /SUPABASE_SERVICE_ROLE_KEY|eyJhbGciOiJIUzI1Ni/
  );

  assert.match(html, /id="goAdmin"/);
  assert.match(html, /id="adminPassword"/);

  const script = html.match(
    /<script>([\s\S]*?)<\/script>/
  );

  assert.ok(script);
  assert.doesNotThrow(() =>
    new Script(script[1])
  );

  const ids = [
    ...html.matchAll(/id="([^"]+)"/g)
  ].map(m => m[1]);

  assert.equal(
    new Set(ids).size,
    ids.length,
    'duplicate element ids'
  );
});

test('conflicting revision returns HTTP 409 without claiming success', async () => {
  const old = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: 'REVISION_CONFLICT'
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json'
        }
      }
    );

  try {
    const res = await worker.fetch(
      req('/api/mutate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.12'
        },
        body: JSON.stringify({
          action: 'record',
          id: 'motion-0001',
          expected_revision: 0
        })
      }),
      baseEnv()
    );

    assert.equal(res.status, 409);

    assert.match(
      (await res.json()).error,
      /再読み込み/
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('daily scheduled task backs up and prunes old R2 objects', async () => {
  const old = globalThis.fetch;
  const saved = [];
  const deleted = [];
  const env = baseEnv();

  env.BACKUPS = {
    put: async (key, value) =>
      saved.push({ key, value }),

    list: async () => ({
      objects: [
        {
          key: 'snapshots/old_daily.json',
          uploaded: new Date(
            '2025-01-01T00:00:00Z'
          )
        },
        {
          key: 'snapshots/recent_daily.json',
          uploaded: new Date()
        }
      ],
      truncated: false
    }),

    delete: async key =>
      deleted.push(key)
  };

  globalThis.fetch = async url =>
    dbResponse(
      url.includes('/motions?')
        ? [
            {
              id: 'motion-0001',
              motion: 'A',
              history: [],
              is_deleted: false,
              revision: 0
            }
          ]
        : []
    );

  try {
    let pending;

    await worker.scheduled(
      {},
      env,
      {
        waitUntil: promise => {
          pending = promise;
        }
      }
    );

    await pending;

    assert.equal(saved.length, 1);
    assert.equal(deleted.length, 1);

    assert.equal(
      deleted[0],
      'snapshots/old_daily.json'
    );
  } finally {
    globalThis.fetch = old;
  }
});
