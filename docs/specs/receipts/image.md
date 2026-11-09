---
type: feature
status: draft
---
# The organizer retrieves the stored receipt photo privately

## Why

The organizer compares extracted items and corrected amounts with the original
photo without exposing storage credentials or granting public access.

## Where it lives

- packages/domain/src/receipt.ts: owner-scoped image metadata lookup.
- apps/web/app/api/receipts/[id]/image/route.ts: GET and storage orchestration.
- packages/services/src/storage.ts: downloadAttachment.
- apps/web/tests/receipts-image-route.test.ts: route and PGlite coverage.
- packages/services/tests/storage.test.ts: missing-blob and outage distinction.

## Behavior

- GET requires an existing session user; missing or unknown identities return
  401. Unknown, missing, foreign and soft-deleted receipts return 404.
- Ownership is checked before storage is contacted. The blob name comes only
  from the owned receipt, never from client input.
- Draft and finalized receipts can return their photo, regardless of parsing
  status. A successful response is 200 with the original bytes, the stored
  supported image Content-Type, Content-Length, Cache-Control: private,
  no-store and X-Content-Type-Options: nosniff.
- A missing blob returns 404. Storage outages return 503 with the standard
  INTERNAL envelope and a retry message. Unexpected errors return generic 500.
- The storage adapter returns null only for an absent blob; it propagates
  other storage errors so callers can distinguish outages from missing images.
- Responses expose no blob names, credentials, storage URLs or SDK errors.
  Reading a photo changes no rows, revision or cache state.

## Examples

| State / input | Result |
|---|---|
| Owner requests a stored PNG | 200 with the original PNG bytes and private headers |
| Owner requests a finalized receipt's photo | 200 |
| Different owner, deleted receipt or missing ID | 404 without a storage call |
| Blob has been removed | 404 with the standard error envelope |
| Azurite is stopped | 503 with a retry message |

## Verify

- pnpm --dir apps/web exec vitest run tests/receipts-image-route.test.ts checks
  byte equality, image types, headers, access guards, unchanged rows, missing
  blobs, storage outages and generic error mapping.
- Storage tests distinguish the SDK's BlobNotFound from transport failures.
- pnpm test, pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Reuse the existing blob adapter; no new dependency or migration is needed.
- ADR-0006 keeps image bytes in blob storage. ADR-0014 restricts reads to the
  organizer; no signed URL or public storage access is introduced.
- Image MIME types are restricted to the upload contract in upload.md.

## Out of scope

- Thumbnails, resizing, replacing photos, range requests and public sharing.
- Upload is specified in upload.md; OCR is specified in parse.md.
