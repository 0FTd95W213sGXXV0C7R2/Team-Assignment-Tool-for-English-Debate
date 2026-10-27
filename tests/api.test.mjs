import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import motionWrite from '../api/motion-write.js';
import motionRestore from '../api/motion-restore.js';
import motionHistory from '../api/motion-history.js';
import motionAdminList from '../api/motion-admin-list.js';
import legacyAddMotion from '../api/add-motion.js';

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
