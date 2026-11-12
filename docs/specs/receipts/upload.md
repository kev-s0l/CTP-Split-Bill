---
type: feature
---
# An organizer uploads a receipt photo and receives an owned draft

## Why

The organizer starts a receipt by saving its photo, then reviews and corrects
the draft before assigning costs and finalizing bills.

## Where it lives

- apps/web/app/api/receipts/route.ts: multipart POST and storage orchestration.
- packages/domain/src/receipt.ts: upload validation and createReceipt.
- packages/domain/src/receipt-access.ts: existing-user guard.
- packages/services/src/storage.ts: container initialization, upload and cleanup.
- apps/web/tests/receipts-upload-route.test.ts: real route and PGlite coverage.
- apps/web/tests/receipts-upload-storage.test.ts: opt-in Azurite round-trip drill.

## Behavior

- POST /api/receipts derives identity from the database session and checks that
  the user exists before reading the body or writing a blob. Missing or unknown
  identities receive 401 with the standard error envelope.
- The body is multipart/form-data with exactly one field, a file named file.
  Malformed bodies, missing/duplicate files, text fields and extra fields return
  400 INVALID_INPUT without a blob upload or receipt write.
- The file is nonempty and at most MAX_ATTACHMENT_BYTES (5 * 1024 * 1024 bytes).
  JPEG, PNG and WebP are supported. Declared MIME type and file signature agree;
  validation checks signatures rather than fully decoding the image.
- The server generates a new receipt ID. The storage adapter sanitizes the
  filename and namespaces the blob under that ID. Client identity, receipt IDs,
  blob names, business state and calculated amounts are never accepted.
- Storage initializes the attachments container when necessary. Unavailable
  storage or a failed upload returns 503 with code INTERNAL and message
  "Image storage is unavailable; try again later". SDK details stay server-side.
- Only after upload succeeds does the domain create the receipt, with ownerId
  from the session and the returned imageBlobName and validated content type.
  The initial state is DRAFT, NOT_STARTED, EVEN, revision 1, currency USD
  and picking paused (receipts/guest-picks.md).
- The same transaction creates the organizer's participant row and records
  it as organizerParticipantId (ADR-0018). Its displayName is the user's name,
  trimmed and cut to 50 characters, or "You" when the name is blank. It has
  no phone, email or pick link, and is not made the payer.
  Metadata and amounts are null, participants and items are empty, and there
  are no bills. Creation does not require expectedRevision.
- Success returns 201 with the existing receipt detail projection and Location:
  /api/receipts/<id>. Internal blob names, extraction and parser errors are not
  returned. The receipt collection is revalidated.
- If database creation fails, the route attempts to delete that upload and
  returns the standard mapped database error. Cleanup failure is logged without
  replacing the original error. Cleanup never deletes an image after database
  creation succeeds; cache invalidation failure is logged and preserves 201.
- Each successful request creates a distinct receipt; there is no retry key.

## Examples

| State / input | Result |
|---|---|
| Signed-in organizer uploads a valid PNG | 201 owned draft; photo saved in blob storage |
| Exactly 5 MiB with an allowed signature | Accepted |
| Empty file, oversized file, or text labelled image/png | 400; no receipt or upload |
| Two file fields, or a supplied ownerId field | 400; no receipt or upload |
| Signed-out request with a malformed body | 401; body is not processed |
| Fresh reachable Azurite | Container is initialized and upload succeeds |
| Storage is unavailable | 503 with the standard envelope; no receipt |
| Database creation fails after upload | Mapped error; blob cleanup is attempted |

## Verify

- pnpm test covers the route against PGlite with auth/storage/cache mocked:
  ownership and defaults, allowed formats and size boundaries, malformed input,
  signature mismatches, authentication, storage failures, database rollback and
  cleanup, cleanup failure, and cache failure after creation.
- pnpm typecheck and pnpm build pass.
- Azurite drill: start an isolated blob emulator with ephemeral persistence,
  set AZURE_STORAGE_CONNECTION_STRING to that instance and
  RECEIPT_UPLOAD_AZURITE=1, then run
  pnpm --dir apps/web exec vitest run tests/receipts-upload-storage.test.ts.
  The drill invokes the real POST with an authenticated test identity and
  PGlite, reads the created draft, downloads and compares its bytes, verifies a
  fresh container is initialized, and removes its test blob. The ordinary suite
  needs no services and skips this opt-in drill.

## Constraints & decisions

- ADR-0006 keeps bytes in blob storage and only the blob name in Postgres.
- ADR-0014 governs direct ownership and receipt-local participants.
- Blob and database writes cannot share a Prisma transaction. Upload-first
  avoids creating a receipt with no uploaded image; cleanup is best effort.
  A process crash or uncertain remote upload outcome may leave an orphan blob.
- Multipart parsing buffers the body; file size validation is not a transport
  request-size limit. Deployment request limits are configured separately.
- Reuse the existing services and Zod dependencies; no migration is needed.

## Out of scope

- OCR and queue jobs, image download, thumbnails, replacing an existing photo,
  guest participant creation, bill generation, image decoding and retry
  deduplication.
- Existing-receipt corrections remain in edit.md and items.md.
