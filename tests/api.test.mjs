import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import motionWrite from '../api/motion-write.js';
import motionRestore from '../api/motion-restore.js';
import motionHistory from '../api/motion-history.js';
import motionAdminList from '../api/motion-admin-list.js';
import legacyAddMotion from '../api/add-motion.js';
import { normalizeNonNegativeBigint } from '../api/_admin.js';

const adminToken = 'test-admin-token-not-a-credential';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function request({ method = 'POST', body = {}, query = {}, token = adminToken } = {}) {
  return {
    method,
    body,
    query,
    headers: token ? { authorization: `Bearer ${token}` } : {}
  };
}

function apiResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    }
  };
}

test('motion write rejects anonymous requests before contacting Supabase', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected network call');
  };
  try {
    const res = responseRecorder();
    await motionWrite(request({ token: '' }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write preserves bigint revision values in Supabase JSON', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '{ "id": 9007199254740993, "revision" : 9007199254740993 , "audit_id":9007199254740995,"motion":"saved" }';
    }
  });
  try {
    const res = responseRecorder();
    await motionWrite(request({
      body: {
        action: 'insert',
        row: { motion: 'THW test', tournament: '', year: '2026', history: [] }
      }
    }), res);
    assert.equal(res.body.id, '9007199254740993');
    assert.equal(res.body.revision, '9007199254740993');
    assert.equal(res.body.audit_id, '9007199254740995');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write rejects unknown fields and malformed values', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  for (const row of [
    { motion: 'Valid', tournament: '', year: '2026', history: [], extra: 'not allowed' },
    { motion: '   ', tournament: '', year: '2026', history: [] },
    { motion: 'Valid', tournament: '', year: '2026', history: ['not a date'] }
  ]) {
    const res = responseRecorder();
    await motionWrite(request({ body: { action: 'insert', row } }), res);
    assert.equal(res.statusCode, 400);
  }
});

test('motion write sends inserts to the transactional RPC', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, options };
    return apiResponse(200, { id: 42, revision: 0 });
  };
  try {
    const res = responseRecorder();
    await motionWrite(request({
      body: {
        action: 'insert',
        row: {
          motion: 'THW test',
          tournament: 'Test',
          year: '2026',
          history: []
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.match(sent.url, /\/rpc\/motion_apply$/);
    assert.equal(sent.options.method, 'POST');
    assert.equal(JSON.parse(sent.options.body).p_action, 'insert');
    assert.equal(JSON.parse(sent.options.body).p_expected_revision, null);
    assert.equal(JSON.stringify(res.body).includes(process.env.SUPABASE_SERVICE_ROLE_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write uses bigint revision strings for the existing RPC', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return apiResponse(200, { id: 42, revision: '9007199254740993' });
  };
  try {
    const res = responseRecorder();
    await motionWrite(request({
      body: {
        action: 'update',
        id: '42',
        expectedRevision: '9007199254740993',
        row: { motion: 'THW test', tournament: '', year: '2026', history: [] }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.p_expected_revision, '9007199254740993');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion update, delete, and usage record keep the motion_apply request shape', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return apiResponse(200, { id: 42, revision: 11 });
  };
  try {
    const row = { motion: 'THW test', tournament: '', year: '2026', history: [] };
    for (const action of ['update', 'delete', 'record']) {
      const res = responseRecorder();
      await motionWrite(request({
        body: { action, id: '42', row: action === 'update' ? row : null, expectedRevision: '10' }
      }), res);
      assert.equal(res.statusCode, 200);
    }
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.url.endsWith('/rpc/motion_apply')));
    assert.deepEqual(calls.map(call => call.body.p_action), ['update', 'delete', 'record']);
    assert.ok(calls.every(call => call.body.p_expected_revision === '10'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write translates revision conflicts to HTTP 409', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => apiResponse(400, { message: 'REVISION_CONFLICT' });
  try {
    const res = responseRecorder();
    await motionWrite(request({
      body: {
        action: 'update',
        id: '42',
        expectedRevision: 3,
        row: { motion: 'THW test', tournament: '', year: '2026', history: [] }
      }
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'REVISION_CONFLICT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write translates duplicate errors to HTTP 409 and rate limits to 429', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  try {
    for (const [message, status] of [['DUPLICATE_MOTION', 409], ['RATE_LIMIT_EXCEEDED', 429]]) {
      globalThis.fetch = async () => apiResponse(400, { message });
      const res = responseRecorder();
      await motionWrite(request({
        body: { action: 'insert', row: { motion: 'THW test', tournament: '', year: '2026', history: [] } }
      }), res);
      assert.equal(res.statusCode, status);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('motion write normalizes numeric database IDs', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return apiResponse(200, { id: 42, revision: 1 });
  };
  try {
    const res = responseRecorder();
    await motionWrite(request({
      body: { action: 'delete', id: 42, expectedRevision: 0 }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.p_id, '42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('restore calls the existing checked bigint RPC and returns its response shape', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return apiResponse(200, { id: 42, revision: '9007199254740994', motion: 'restored' });
  };
  try {
    const res = responseRecorder();
    await motionRestore(request({
      body: {
        id: '42',
        auditId: '9007199254741000',
        expectedRevision: '9007199254740993'
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.match(sent.url, /\/rpc\/motion_restore_revision_checked$/);
    assert.deepEqual(sent.body, {
      p_id: '42',
      p_audit_id: '9007199254741000',
      p_expected_revision: '9007199254740993'
    });
    assert.deepEqual(res.body, {
      restored: { id: 42, revision: '9007199254740994', motion: 'restored' }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('restore maps duplicate and revision conflicts without hiding them', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  try {
    for (const message of ['DUPLICATE_MOTION', 'REVISION_CONFLICT']) {
      globalThis.fetch = async () => apiResponse(400, { message });
      const res = responseRecorder();
      await motionRestore(request({
        body: { id: '42', auditId: '5', expectedRevision: '10' }
      }), res);
      assert.equal(res.statusCode, 409);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('history returns the rows shape used by the admin page', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  process.env.SUPABASE_URL = 'https://development-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-credential';
  const originalFetch = globalThis.fetch;
  const rows = [{ audit_id: 7, motion_id: '42', action: 'UPDATE', before_data: { motion: 'old' }, after_data: { motion: 'new' } }];
  globalThis.fetch = async url => {
    assert.match(url, /motion_audit\?motion_id=eq\.42/);
    return apiResponse(200, rows);
  };
  try {
    const res = responseRecorder();
    await motionHistory(request({ method: 'GET', query: { id: '42' } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { rows });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bigint validation preserves exact values and rejects overflow', () => {
  assert.equal(normalizeNonNegativeBigint('9007199254740993'), '9007199254740993');
  assert.equal(normalizeNonNegativeBigint(42), '42');
  assert.equal(normalizeNonNegativeBigint('9223372036854775807'), '9223372036854775807');
  assert.equal(normalizeNonNegativeBigint('9223372036854775808'), null);
  assert.equal(normalizeNonNegativeBigint('1.5'), null);
});

test('restore and history endpoints reject unauthenticated access', async () => {
  process.env.ADMIN_API_TOKEN = adminToken;
  for (const handler of [motionRestore, motionHistory, motionAdminList]) {
    const res = responseRecorder();
    await handler(request({
      method: handler === motionHistory || handler === motionAdminList ? 'GET' : 'POST',
      token: ''
    }), res);
    assert.equal(res.statusCode, 401);
  }
});

test('legacy GitHub write endpoint is disabled', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected network call');
  };
  try {
    const res = responseRecorder();
    await legacyAddMotion(request(), res);
    assert.equal(res.statusCode, 410);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser pages do not store GitHub or service-role credentials', async () => {
  for (const file of ['index.html', 'admin.html', 'add.html']) {
    const contents = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(contents.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.equal(contents.includes("localStorage.setItem('ghToken'"), false);
  }
});

test('transactional RPC migration is disabled and cannot define integer overloads', async () => {
  const migration = await readFile(
    new URL('../migrations/20261027_motion_transactional_audit_rpc.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /RAISE EXCEPTION/);
  assert.doesNotMatch(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  assert.doesNotMatch(migration, /motion_apply\s*\(\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*integer/i);
  assert.doesNotMatch(migration, /motion_restore_revision_checked\s*\([^)]*integer/i);
});
