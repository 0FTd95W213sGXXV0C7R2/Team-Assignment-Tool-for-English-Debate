import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../api/_admin.js';
test('admin token is required', () => {
  process.env.ADMIN_API_TOKEN='a'.repeat(64);
  assert.equal(requireAdmin({headers:{}}),false);
  assert.equal(requireAdmin({headers:{authorization:'Bearer wrong'}}),false);
  assert.equal(requireAdmin({headers:{authorization:'Bearer '+'a'.repeat(64)}}),true);
});
