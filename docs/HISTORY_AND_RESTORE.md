# Motion History and Restore

## 1. History

The development database records previous motion rows
before UPDATE and DELETE operations.

Administrators can inspect the history with:

    SELECT id, motion_id, operation, backed_up_at, previous_row
    FROM public.motion_change_backups
    ORDER BY id DESC
    LIMIT 100;

## 2. Restore

Automatic restoration is not implemented yet.

Before restoring:

1. Verify the backup record.
2. Verify the current motion data.
3. Check for concurrent edits.
4. Perform restoration in a transaction.
5. Verify the restored result.

## 3. Security

History data must not be publicly accessible.

Do not execute migrations against production
before development testing is complete.

## 4. Limitations

- INSERT history is not implemented.
- Automatic restoration is not implemented.
- The history management UI is not implemented.
- Database schema compatibility must be verified.
