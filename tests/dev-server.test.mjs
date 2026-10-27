import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentServer } from '../dev-server.mjs';

async function withServer(run) {
  const server = createDevelopmentServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function withEnvironment(values, run) {
  const previous = new Map(
    Object.keys(values).map(name => [name, process.env[name]])
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

test('serves the requested pages and rejects non-whitelisted paths', async () => {
  await withServer(async baseUrl => {
    for (const page of ['/', '/index.html', '/add.html', '/admin.html']) {
      const response = await fetch(baseUrl + page);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/html/);
    }
    const traversal = await fetch(baseUrl + '/%2e%2e/package.json');
    assert.equal(traversal.status, 404);
    assert.doesNotMatch(await traversal.text(), /private|scripts/);
  });
});

test('dispatches API handlers with their existing method and auth responses', async () => {
  await withEnvironment({
    ADMIN_API_TOKEN: 'server-only-test-token',
    SUPABASE_URL: 'https://development-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  }, async () => {
    const originalFetch = globalThis.fetch;
    let rpcCall;
    globalThis.fetch = async (input, options) => {
      if (String(input).startsWith('https://development-project.supabase.co/')) {
        rpcCall = { url: String(input), body: JSON.parse(options.body) };
        return new Response('{"id":42,"revision":0}', { status: 200 });
      }
      return originalFetch(input, options);
    };
    try {
      await withServer(async baseUrl => {
        const wrongMethod = await fetch(baseUrl + '/api/motion-write.js');
        assert.equal(wrongMethod.status, 405);

        const anonymous = await fetch(baseUrl + '/api/motion-write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'insert' })
        });
        assert.equal(anonymous.status, 401);
        assert.deepEqual(await anonymous.json(), { error: 'Unauthorized' });

        const authorized = await fetch(baseUrl + '/api/motion-write', {
          method: 'POST',
          headers: {
            authorization: 'Bearer server-only-test-token',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            action: 'insert',
            row: { motion: 'Test motion', tournament: '', year: '2026', history: [] }
          })
        });
        assert.equal(authorized.status, 200);
        assert.deepEqual(await authorized.json(), { id: 42, revision: 0 });
        assert.equal(rpcCall.url, 'https://development-project.supabase.co/rest/v1/rpc/motion_apply');
        assert.equal(rpcCall.body.p_action, 'insert');

        const disabledLegacy = await fetch(baseUrl + '/api/add-motion');
        assert.equal(disabledLegacy.status, 410);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('reports missing server configuration without exposing values', async () => {
  await withEnvironment({
    ADMIN_API_TOKEN: undefined,
    SUPABASE_URL: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined
  }, async () => {
    await withServer(async baseUrl => {
      const publicResponse = await fetch(baseUrl + '/api/motion-list');
      assert.equal(publicResponse.status, 503);
      const publicBody = await publicResponse.json();
      assert.deepEqual(publicBody.missing, [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY'
      ]);

      const anonymousAdmin = await fetch(baseUrl + '/api/motion-write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'insert' })
      });
      assert.equal(anonymousAdmin.status, 401);

      process.env.ADMIN_API_TOKEN = 'server-only-test-token';
      const configuredAdmin = await fetch(baseUrl + '/api/motion-write', {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-only-test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action: 'insert' })
      });
      assert.equal(configuredAdmin.status, 503);
      const configBody = await configuredAdmin.json();
      assert.deepEqual(configBody.missing, [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY'
      ]);
      assert.doesNotMatch(JSON.stringify({ publicBody, configBody }), /server-only|development-project/);
    });
  });
});

test('validates JSON bodies and preserves API validation status codes', async () => {
  await withEnvironment({
    ADMIN_API_TOKEN: 'server-only-test-token',
    SUPABASE_URL: 'https://development-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  }, async () => {
    await withServer(async baseUrl => {
      const malformed = await fetch(baseUrl + '/api/motion-write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{'
      });
      assert.equal(malformed.status, 400);

      const authenticated = await fetch(baseUrl + '/api/motion-write', {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-only-test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ action: 'unknown' })
      });
      assert.equal(authenticated.status, 400);
      assert.deepEqual(await authenticated.json(), { error: 'Invalid action' });
    });
  });
});
