# Team-Assignment-Tool-for-English-Debate

## Local development server

Use Node.js 24 and start the development-only HTTP server with:

```sh
npm run dev
```

It listens on port 3000 on all interfaces (including Codespaces forwarding),
serves `index.html`, `add.html`, and `admin.html`, and dispatches the existing
`api/*.js` handlers without changing their API contracts. The server reads
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_API_TOKEN` only from
its server-side environment. Never put these values in browser code or commit
them. Public motion-list reads require the Supabase URL and service-role key;
admin APIs additionally require the admin token. Missing configuration is
reported by variable name only and API requests receive HTTP 503 where
applicable.

The `POST /api/motion-record` endpoint is the sole unauthenticated write API.
It accepts only a motion `id` and `expectedRevision` and records usage through
the existing `motion_apply` RPC; all motion content changes, deletion, and
restore operations continue to require the admin token.

Run the automated checks with:

```sh
npm test
```
