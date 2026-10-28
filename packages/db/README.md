# Database schema, client and SQL migrations

This package owns the Prisma schema/client, SQL migration loader and demo seed.
The domain contains User, Receipt, Participant, ReceiptItem,
SharedItemAllocation and Bill. Receipts authorize their organizer directly.

## Commands

- pnpm prisma:generate regenerates the TypeScript client; it does not alter SQL.
- pnpm db:migrate applies pending SQL against the configured database.
- pnpm db:seed creates idempotent demo users and owned receipt data.
- The local database server also applies pending SQL on startup.

## Migration format

The loader reads flat .sql files in prisma/migrations, sorts filenames and
records applied names in _migrations. Keep 0001_init.sql unchanged; the
receipt remodel is 0002_receipt_remodel.sql. Do not introduce a second migration
history or depend on nested migration.sql directories being discovered.

Fresh databases apply both migrations. Existing databases apply only pending
ones. Tests apply the same files to memory:// PGlite.

The remodel reuses tables through renames and converts receipt-local references
before dropping Party and Payment. It preserves receipt/item/bill IDs and bill
amounts. A member keeps their ID on the first receipt and gets deterministic
copies for additional receipts. Organizer ownership replaces uploader ownership.

The upgrade aborts atomically for foreign legacy references, unequal active
shares, partial/overpaid payment balances or invalid monetary/quantity data.
Reconcile those rows explicitly before retrying; no reset or silent conversion
is performed. Existing exact payment balances become manual paidAt markers.
A failed migration is not recorded as applied.

Do not run db:migrate or restart the local DB until ready to apply pending
changes to that database. Validation and test commands do not migrate .pgdata.

## Client and tests

The singleton client uses PGlite when PGLITE_DATA_DIR is set, otherwise the
configured Postgres URL or local default. Generated client files remain ignored.
Migration tests in apps/web/tests/migration.test.ts cover legacy conversion,
same-receipt foreign keys and rollback. The domain seed drill verifies the
review/finalize flow without external services.

See docs/specs/receipts/model.md and ADR-0014 for the model and migration contract.
