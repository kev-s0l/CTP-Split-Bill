# Receipt parsing reports OCR unavailable

**Use when:** provisioning a workstation/deployment or diagnosing parse 503 responses.
**Last drilled:** local English model and real OCR route drill pass against PGlite.

## Before you start

- Use the repository root and install dependencies with pnpm.
- Allow network access for setup only; parsing uses local assets.
- Keep .ocr/ out of git. Do not edit .env, .pgdata/ or .azurite/.
- Keep the deployed workspace manifest, packages/services/src/ocr-worker.cjs
  and installed services dependencies alongside the web app. The web process
  needs permission to launch a Node child process. This is a Node runtime route.
- Provision the model separately in deployments; it is not bundled into builds.
  Set RECEIPT_OCR_DATA_DIR to an absolute local path when not using root .ocr/.

## Steps

1. Run `pnpm ocr:setup`. Expect `Local English OCR data is ready (SHA-256 verified).`
   The command downloads English tessdata_fast 4.1.0 from its pinned upstream
   release only if the existing file is absent or fails its checksum.
2. Verify the file hash. In PowerShell run
   `Get-FileHash -Algorithm SHA256 .ocr/eng.traineddata` (use the configured
   absolute directory instead when applicable). Expect
   `7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2`.
3. Run the real OCR route drill in PowerShell:

   ```powershell
   $env:RECEIPT_OCR_DRILL = '1'
   try {
     pnpm --dir apps/web exec vitest run tests/receipts-ocr.test.ts
   } finally {
     Remove-Item Env:RECEIPT_OCR_DRILL
   }
   ```

4. Expect the drill to pass. It reads the checked-in synthetic receipt PNG with
   actual Tesseract, calls the real parse route, and verifies persisted Soup
   10.00, Tea 3.00, subtotal 13.00, tax 1.00, tip 2.00 and total 16.00.
   It mocks blob IO, identity and cache only; the database is in-memory PGlite.
5. For an existing failed draft, reload receipt detail and retry POST
   /api/receipts/<id>/parse with its current expectedRevision. A PARSING attempt
   left by a process crash is retryable after five minutes; earlier retries
   receive 409. Do not change database state manually.

## Verify it worked

- Confirm the drill passes with SUCCEEDED, revision 3, reviewedAt null and both
  items unverified. OCR success does not bypass organizer review.
- Run `pnpm test`, `pnpm typecheck` and `pnpm build`.
- Confirm parse requests make no model downloads; only setup contacts upstream.

## If this didn't work

- Check model readability, the absolute path and child-process permissions.
- Check image storage when image GET also returns 503; OCR setup cannot repair it.
- If only a particular image fails or has no usable item lines, correct it
  manually. Conservative extraction does not support every receipt layout.
- Stop on checksum mismatch; do not disable verification or substitute a
  download from another host. Review a dependency/model update separately.

## Related

- [Parsing contract](../specs/receipts/parse.md)
- [Image retrieval contract](../specs/receipts/image.md)
- [Pinned upstream model and license](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0)
