import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import motionWrite from './api/motion-write.js';
import motionRecord from './api/motion-record.js';
import motionRestore from './api/motion-restore.js';
import motionHistory from './api/motion-history.js';
import motionAdminList from './api/motion-admin-list.js';
import motionCurrent from './api/motion-current.js';
import motionList from './api/motion-list.js';
import addMotion from './api/add-motion.js';
import { requireAdmin } from './api/_admin.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_PAGES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/add.html', 'add.html'],
  ['/admin.html', 'admin.html']
]);
const API_ROUTES = new Map([
  ['motion-write', { handler: motionWrite, method: 'POST', admin: true }],
  ['motion-record', { handler: motionRecord, method: 'POST', admin: false }],
  ['motion-restore', { handler: motionRestore, method: 'POST', admin: true }],
  ['motion-history', { handler: motionHistory, method: 'GET', admin: true }],
  ['motion-admin-list', { handler: motionAdminList, method: 'GET', admin: true }],
  ['motion-current', { handler: motionCurrent, method: 'GET', admin: true }],
  ['motion-list', { handler: motionList, method: 'GET', admin: false }],
  ['add-motion', { handler: addMotion, method: null, admin: false, configuration: [] }]
]);
const REQUIRED_ENV = {
  admin: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_API_TOKEN'],
  public: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
};
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8'
};

function jsonResponse(res, status, value, headOnly = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(headOnly ? undefined : JSON.stringify(value));
}

function queryParameters(searchParams) {
  const query = Object.create(null);
  for (const [key, value] of searchParams) {
    if (!(key in query)) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function missingConfiguration(names) {
  return names.filter(name => !process.env[name]);
}

function apiResponseAdapter(res, headOnly) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(value) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(headOnly ? undefined : JSON.stringify(value));
      return this;
    }
  };
}

async function serveStatic(pathname, res, headOnly) {
  const filename = STATIC_PAGES.get(pathname);
  if (!filename) {
    jsonResponse(res, 404, { error: 'Not found' }, headOnly);
    return;
  }
  const filePath = resolve(ROOT, filename);
  if (!filePath.startsWith(ROOT + sep)) {
    jsonResponse(res, 404, { error: 'Not found' }, headOnly);
    return;
  }
  try {
    const content = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[extname(filePath)] || 'application/octet-stream');
    res.setHeader('Content-Length', content.length);
    res.end(headOnly ? undefined : content);
  } catch {
    jsonResponse(res, 500, { error: 'Failed to load page' }, headOnly);
  }
}

async function dispatchApi(req, res, pathname, headOnly) {
  const routeName = pathname.slice('/api/'.length);
  const normalizedName = routeName.endsWith('.js')
    ? routeName.slice(0, -3)
    : routeName;
  const route = API_ROUTES.get(normalizedName);
  if (!route || normalizedName.includes('/')) {
    jsonResponse(res, 404, { error: 'Not found' }, headOnly);
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(', ');
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    jsonResponse(res, error.statusCode || 400, { error: error.message }, headOnly);
    return;
  }

  const apiRequest = {
    method: req.method,
    headers,
    query: queryParameters(new URL(req.url, 'http://localhost').searchParams),
    body
  };

  if (route.method && route.method !== req.method) {
    await route.handler(apiRequest, apiResponseAdapter(res, headOnly));
    return;
  }

  const required = route.configuration || REQUIRED_ENV[route.admin ? 'admin' : 'public'];
  const missing = missingConfiguration(route.admin && !requireAdmin(apiRequest)
    ? []
    : required);
  if (missing.length) {
    jsonResponse(res, 503, {
      error: 'Development server configuration is incomplete',
      missing
    }, headOnly);
    return;
  }

  try {
    await route.handler(apiRequest, apiResponseAdapter(res, headOnly));
  } catch {
    console.error(`Unhandled development API error: ${normalizedName}`);
    jsonResponse(res, 500, { error: 'Internal server error' }, headOnly);
  }
}

export function createDevelopmentServer() {
  return createServer(async (req, res) => {
    const headOnly = req.method === 'HEAD';
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      jsonResponse(res, 400, { error: 'Invalid URL' }, headOnly);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await dispatchApi(req, res, url.pathname, headOnly);
      return;
    }
    if (req.method !== 'GET' && !headOnly) {
      jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }
    await serveStatic(url.pathname, res, headOnly);
  });
}

function logStartupConfiguration() {
  const missing = [...new Set([
    ...missingConfiguration(REQUIRED_ENV.public),
    ...missingConfiguration(REQUIRED_ENV.admin)
  ])];
  if (missing.length) {
    console.error(`Development API configuration missing: ${missing.join(', ')}`);
  }
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const server = createDevelopmentServer();
  server.listen(port, '0.0.0.0', () => {
    logStartupConfiguration();
    console.log(`Development server listening on http://0.0.0.0:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
