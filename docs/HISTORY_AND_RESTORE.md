# Motion history and restore

## Transactional writes

All motion insert, update, logical delete, usage-record, and restore operations
must use the server-side API and the `motion_apply` or
`motion_restore_revision_checked` PostgreSQL RPC. The RPC locks the selected
motion, compares its revision, and writes the audit entry in the same database
transaction as the row change. Audit failure aborts the transaction. Insert
records have a null `before_data` and the created row in `after_data`.

The development database's existing `motions_audit_trigger` writes the
before/after snapshot to `motion_audit` in the same transaction. A logical
deletion is an UPDATE (`is_deleted = true`), so the audit event is an UPDATE
with the soft-deleted state in `after_data`.

The audit table is in the same database as the motions. It protects against
application mistakes and provides change history; it is not an independent
backup and cannot protect against loss of the database itself.
Do not disable or replace existing audit triggers or delete existing audit
rows as part of the API compatibility work.

## Restore

The development-only `admin.html` loads active and deleted motions and their
history through authenticated server APIs. It shows the current row and the
selected snapshot before confirming a restore. A restore checks the current
revision under a row lock, restores the selected audit row's `before_data`,
increments the revision, and records the before/after restore as an UPDATE
audit event.

## Security

- The browser receives only the admin API token entered by the operator; it
  never receives `SUPABASE_SERVICE_ROLE_KEY`.
- Admin API endpoints require the server-side `ADMIN_API_TOKEN`.
- The service-role key and Supabase URL are read only from server environment
  variables.
- Public and authenticated roles have no write privileges on `motion_audit`.
- The migration does not change RLS policies.
- The legacy GitHub contents API write endpoint is disabled.

## Development setup and validation

The development database already provides bigint `motion_apply` and
`motion_restore_revision_checked` RPCs plus the `motions_audit_trigger`.
`migrations/20261027_motion_transactional_audit_rpc.sql` is intentionally
disabled and raises an exception before making changes. Do not apply it.
Preserve the existing RPC definitions, audit trigger, write limits, and
duplicate handling. Any future schema change requires review against the live
development schema first.

The API accepts bigint revisions as decimal strings to avoid JavaScript
precision loss and forwards them to the existing RPC signatures. Supabase
integer fields named `id`, `revision`, and `audit_id` are returned as strings
when their values exceed JavaScript's safe integer range.

Run local API tests with:

    npm test

Run SQL integration checks only against a disposable PostgreSQL instance with
an explicit fixture for the existing bigint RPC contract. Run them against
development only after confirming the statements cannot affect persisted data.
Never use production credentials or print credentials to logs.
