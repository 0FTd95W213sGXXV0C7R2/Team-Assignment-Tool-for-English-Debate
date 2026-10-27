# Motion history and restore

## Transactional writes

All motion insert, update, logical delete, usage-record, and restore operations
must use the server-side API and the `motion_apply` or
`motion_restore_revision_checked` PostgreSQL RPC. The RPC locks the selected
motion, compares its revision, and writes the audit entry in the same database
transaction as the row change. Audit failure aborts the transaction. Insert
records have a null `before_data` and the created row in `after_data`.

The RPC uses an existing `motions` trigger that writes to `motion_audit` when
one is installed for the relevant event. Otherwise, it writes the same
before/after snapshot directly, within the transaction. A logical deletion is
an UPDATE (`is_deleted = true`), so the audit event is an UPDATE with the
soft-deleted state in `after_data`.

The audit table is in the same database as the motions. It protects against
application mistakes and provides change history; it is not an independent
backup and cannot protect against loss of the database itself.
The migration disables the older `motion_change_backups` trigger to avoid
duplicate captures, but does not drop that table or delete its existing rows.

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

Review the existing development `motions` and `motion_audit` schemas and audit
trigger definitions before applying
`migrations/20261027_motion_transactional_audit_rpc.sql` to the development
database. The migration is not authorized for production.

Run local API tests with:

    npm test

Run SQL integration checks only against a disposable PostgreSQL instance or
the approved development database, inside a transaction that is rolled back.
Never use production credentials or print credentials to logs.
