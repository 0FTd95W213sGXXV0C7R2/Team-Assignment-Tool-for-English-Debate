
/** Cloudflare Worker. Supabase service-role key and admin password must be Secrets. */
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const fail = (error, status = 400) => reply({ error }, status);
const enc = new TextEncoder();

async function db(env, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : `DATABASE_ERROR_${res.status}`;
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function readPaged(env, table, query, max = 50000) {
  const rows = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const page = await db(env, `${table}?${query}&limit=1000&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('DATABASE_RESPONSE_INVALID');
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error('DATA_LIMIT_EXCEEDED');
}

const readMotions = env => readPaged(env, 'motions', 'select=id,motion,tournament,year,history,is_deleted,revision&order=id.asc');
const readAudit = env => readPaged(env, 'motion_audit', 'select=*&order=audit_id.asc');

function validateHistory(history) {
  return Array.isArray(history) && history.length <= 500 && history.every(v =>
    typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
  );
}
function validateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('入力データが不正です。');
  const motion = typeof row.motion === 'string' ? row.motion.trim() : '';
  const tournament = typeof row.tournament === 'string' ? row.tournament.trim() : '';
  const year = typeof row.year === 'string' ? row.year.trim() : '';
  if (!motion || motion.length > 1500) throw new Error('論題は1〜1500文字で入力してください。');
  if (!tournament || tournament.length > 180) throw new Error('大会名は1〜180文字で入力してください。');
  if (year.length > 40) throw new Error('年度が長すぎます。');
  if (!validateHistory(row.history)) throw new Error('実施履歴の形式が不正です。');
  return { motion, tournament, year, history: row.history };
}
function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('IDが不正です。');
  return id;
}
function validateRevision(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('変更前の版番号が不正です。再読み込みしてください。');
  return v;
}
async function readJson(request, maxBytes = 12000) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new Error('JSON形式で送信してください。');
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw new Error('送信データが大きすぎます。');
  const content = await request.text();
  if (enc.encode(content).byteLength > maxBytes) throw new Error('送信データが大きすぎます。');
  let value;
  try { value = JSON.parse(content); } catch { throw new Error('JSON形式が不正です。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('入力データが不正です。');
  return value;
}
function errorStatus(error) {
  const msg = error.message || '';
  if (msg.includes('RATE_LIMIT')) return 429;
  if (msg.includes('CONFLICT') || msg.includes('DUPLICATE') || msg.includes('DELETED')) return 409;
  if (msg.includes('NOT_FOUND')) return 404;
  if (msg.includes('INVALID') || msg.includes('MISSING')) return 400;
  return error.status ? 502 : 400;
}
function friendly(error) {
  const msg = error.message || '';
  if (msg.includes('RATE_LIMIT')) return '操作回数の制限に達しました。時間をおいて再試行してください。';
  if (msg.includes('REVISION_CONFLICT')) return '別の人が先に変更しました。再読み込みしてから操作してください。';
  if (msg.includes('DUPLICATE')) return '同一の論題・大会名・年度がすでに登録されています。';
  if (msg.includes('NOT_FOUND')) return '対象の論題が見つかりません。';
  if (msg.includes('DELETED')) return 'この論題は削除済みです。';
  if (msg.includes('INVALID') || msg.includes('MISSING')) return '入力データが不正です。';
  if (error.status) return 'データベース処理に失敗しました。';
  return msg.slice(0, 200) || '操作に失敗しました。';
}
async function ipHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) throw new Error('接続元を確認できません。');
  const bytes = await crypto.subtle.digest('SHA-256', enc.encode(`${env.RATE_SALT}|${ip}`));
  return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
}
async function adminAllowed(request, env) {
  const candidate = request.headers.get('x-admin-password') || '';
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 32 || candidate.length < 32 || candidate.length > 1024) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(candidate)),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_PASSWORD)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function mutate(request, env) {
  let input;
  try { input = await readJson(request); } catch (e) { return fail(e.message); }
  const action = input.action;
  if (!['insert', 'update', 'delete', 'record'].includes(action)) return fail('不明な操作です。');
  let row = null, id = null, expectedRevision = null;
  try {
    if (action === 'insert' || action === 'update') row = validateRow(input.row);
    if (action !== 'insert') {
      id = validateId(input.id);
      expectedRevision = validateRevision(input.expected_revision);
    }
  } catch (e) { return fail(e.message); }
  try {
    const clientHash = await ipHash(request, env);
    const result = await db(env, 'rpc/motion_apply', {
      method: 'POST',
      body: { p_action: action, p_id: id, p_row: row, p_expected_revision: expectedRevision, p_client_hash: clientHash },
    });
    return reply({ ok: true, result });
  } catch (e) { return fail(friendly(e), errorStatus(e)); }
}

async function backup(env, label = 'daily') {
  if (!env.BACKUPS) throw new Error('R2_BINDING_MISSING');
  const [rows, audit] = await Promise.all([readMotions(env), readAudit(env)]);
  if (!rows.length) throw new Error('EMPTY_SNAPSHOT_REFUSED');
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const key = `snapshots/${stamp}_${label}.json`;
  const snapshot = { schema_version: 2, created_at: createdAt, motions_count: rows.length, audit_count: audit.length, rows, audit };
  await env.BACKUPS.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
  return { key, count: rows.length, audit_count: audit.length };
}
async function prune(env) {
  let cursor;
  const cutoff = Date.now() - 90 * 86400000;
  do {
    const page = await env.BACKUPS.list({ prefix: 'snapshots/', cursor, limit: 1000 });
    for (const object of page.objects) {
      if (new Date(object.uploaded).getTime() < cutoff) await env.BACKUPS.delete(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
async function listBackups(env) {
  const entries = [];
  let cursor;
  do {
    const page = await env.BACKUPS.list({ prefix: 'snapshots/', cursor, limit: 1000 });
    entries.push(...page.objects.map(x => ({ key: x.key, size: x.size, uploaded: x.uploaded })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && entries.length < 10000);
  return entries.sort((a, b) => b.key.localeCompare(a.key));
}
function validBackupKey(key) {
  return typeof key === 'string' && /^snapshots\/\d{4}-\d{2}-\d{2}T[\d-]+Z_(daily|manual|pre-restore)\.json$/.test(key);
}
async function adminApi(request, env, path, url) {
  if (!(await adminAllowed(request, env))) return fail('管理者認証に失敗しました。', 403);
  if (request.method === 'GET' && path === '/api/admin/deleted') {
    const rows = await db(env, 'motions?select=id,motion,tournament,year,history,revision&is_deleted=eq.true&order=id.asc&limit=1000');
    return reply({ rows });
  }
  if (request.method === 'GET' && path === '/api/admin/audit') {
    const rows = await db(env, 'motion_audit?select=audit_id,motion_id,action,before_data,after_data,changed_at,actor&order=audit_id.desc&limit=100');
    return reply({ rows });
  }
  if (request.method === 'POST' && path === '/api/admin/restore-one') {
    const input = await readJson(request);
    const id = validateId(input.id);
    const result = await db(env, 'rpc/motion_admin_restore', { method: 'POST', body: { p_id: id } });
    return reply({ ok: true, result });
  }
  if (request.method === 'GET' && path === '/api/admin/backups') return reply({ backups: await listBackups(env) });
  if (request.method === 'POST' && path === '/api/admin/backup') return reply(await backup(env, 'manual'));
  if (request.method === 'GET' && path === '/api/admin/download') {
    const key = url.searchParams.get('key');
    if (!validBackupKey(key)) return fail('ファイル名が不正です。');
    const obj = await env.BACKUPS.get(key);
    if (!obj) return fail('バックアップが見つかりません。', 404);
    return new Response(obj.body, {
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="motions-backup.json"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  if (request.method === 'POST' && path === '/api/admin/restore-all') {
    const input = await readJson(request, 15000);
    if (input.confirm !== '全件復元する' || !validBackupKey(input.key)) return fail('復元の確認ができませんでした。');
    const obj = await env.BACKUPS.get(input.key);
    if (!obj) return fail('バックアップが見つかりません。', 404);
    const snapshot = await obj.json();
    if (snapshot.schema_version !== 2 || !Array.isArray(snapshot.rows) || snapshot.rows.length < 1 || snapshot.rows.length > 50000 ||
        !snapshot.rows.every(r => typeof r.id === 'string' && typeof r.motion === 'string' && typeof r.tournament === 'string' && validateHistory(r.history))) {
      return fail('バックアップの形式が不正です。');
    }
    // Fail closed: if the pre-restore backup fails, do not alter the database.
    await backup(env, 'pre-restore');
    const result = await db(env, 'rpc/motion_restore_snapshot', { method: 'POST', body: { p_rows: snapshot.rows } });
    return reply({ ok: true, restored: result });
  }
  return fail('管理者APIが見つかりません。', 404);
}
async function api(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/motions') {
    const rows = await readMotions(env);
    return reply({ rows: rows.filter(row => !row.is_deleted).map(({ is_deleted, ...row }) => row) });
  }
  if (request.method === 'POST' && path === '/api/mutate') return mutate(request, env);
  if (path.startsWith('/api/admin/')) return adminApi(request, env, path, url);
  return fail('APIが見つかりません。', 404);
}
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RATE_SALT) return fail('サーバーの設定が未完了です。', 503);
    if (request.method !== 'GET' && request.method !== 'POST') return fail('許可されていないメソッドです。', 405);
    if (request.method === 'POST') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return fail('異なるサイトからの操作は許可されていません。', 403);
    }
    try { return await api(request, env, url); }
    catch (e) { console.error('API failure', e?.message); return fail('サーバー処理に失敗しました。', 500); }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => { await backup(env, 'daily'); await prune(env); })());
  },
};
export default worker;
export { validateRow, validateHistory, validBackupKey, readPaged, backup, mutate, adminAllowed };
