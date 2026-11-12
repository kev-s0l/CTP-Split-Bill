# Receipt routes failed to compile under Turbopack in local development

**Filed:** [issue #48](https://github.com/kev-s0l/CTP-Split-Bill/issues/48) · **Fixed:** [PR #60](https://github.com/kev-s0l/CTP-Split-Bill/pull/60) · **Spec:** [web](../specs/web.md), [upload](../specs/receipts/upload.md), [parsing](../specs/receipts/parse.md)

## Report

In local development, receipt routes importing the shared services entry point
returned 500 because Turbopack could not resolve the OCR child-process runner.
The reported error referenced
`apps/web/packages/services/src/ocr-worker.cjs`, although the runner lives at
`packages/services/src/ocr-worker.cjs` in the workspace root. Production builds
and routes importing only the domain package were reported unaffected.

Smallest reported reproduction:

1. With the original `next dev --turbopack` script, start `pnpm dev`.
2. Sign in and request `GET /api/receipts`.
3. Observe a 500 and a module-resolution error whose import trace reaches
   `packages/services/src/ocr.ts`.

## Expected vs actual

The upload spec states, "Success returns 201 with the existing receipt detail
projection"; the parsing spec states, "Success returns 200 with receipt detail
and revalidates receipt/history caches."

Actual development requests failed while compiling the route, before upload,
authentication checks or parsing could execute. Neither spec explicitly
required a receipt HTTP drill through `pnpm dev` or described the development
bundler compatibility requirement. That verification gap allowed production
build success to stand in for local development compatibility.

## Root cause

`packages/services/src/index.ts` re-exports `recognizeReceipt` from `ocr.ts`.
Receipt routes that need storage therefore also bring the OCR adapter into
the module graph processed by the development bundler.

The adapter calls
`fork(join(root, "packages/services/src/ocr-worker.cjs"))`, with `root` found
at runtime by walking upward from the process working directory to
`pnpm-workspace.yaml`. Turbopack analyzes the `fork()` argument as a module
reference, but its static resolution does not reproduce that runtime workspace
lookup. The reported resolution instead placed the workspace-relative suffix
under `apps/web`, causing compilation to fail.

The pinned Next.js 15.5.21 configuration selected Turbopack explicitly for
development and used webpack for `next build`. That difference exposed a
development failure which a successful production build did not detect.

## The fix

Change `apps/web/package.json`'s development script from
`next dev --turbopack` to `next dev`. For the pinned Next.js 15.5.21 version,
this uses webpack for development as well as the existing production build,
avoiding the failing Turbopack analysis of the OCR worker path.

## Why our defenses missed it

Route tests invoke handlers through Vitest with external seams mocked. The OCR
unit tests also mock `fork()`, and the opt-in real OCR drill runs through
Vitest. These tests exercise application behavior without compiling routes
through the Next.js development bundler.

`pnpm build` exercises webpack, so it does not cover the Turbopack-specific
failure either. The missing defense was an actual authenticated receipt
workflow against the development server.

## What changed beyond the fix

The web spec now documents the development bundler choice, the parse
route's worker trace, and what re-enabling Turbopack requires, and its Verify
section gains a development-server receipt drill and a build-trace check.
`apps/web/README.md` no longer says the dev server uses Turbopack. No
automated regression test or test configuration change was added.

The fix is the stopgap: `packages/services/src/index.ts` still re-exports the
OCR adapter, so any route importing `@project/services` still carries the
`fork()` call. A Next.js upgrade that makes Turbopack the default for
`next dev` would bring the failure back unless the worker path is first kept
out of Turbopack's analysis.

The developer supplied the following results after changing the dev script:

| Check | Observed result |
|---|---|
| GitHub sign-in and `GET /api/receipts` | Sign-in worked; receipt listing returned 200 with an initially empty list |
| Receipt photo upload | `POST /api/receipts` returned 201 |
| Uploaded image retrieval | `GET /api/receipts/<id>/image` returned 200 |
| Receipt parsing | Browser-console POST with `expectedRevision: 1` returned 200 |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed, including compilation of the parse route and build-trace collection |
| Default `pnpm test` | Domain and services passed; web failed on a 10-second migration-test setup timeout |
| Migration test file alone | All 12 tests passed |
| `pnpm --dir apps/web exec vitest run --maxWorkers=1` | 329 web tests passed; two opt-in drills skipped |

The parsing response body was not supplied, so extracted values and persisted
results were not independently inspected in this investigation. A
production-runtime parse was not checked. The two opt-in Vitest drills were
not run; the live upload and parse requests above are separate manual
evidence.

Review re-ran both sides of the fix on the same code. With
`next dev --turbopack`, a signed-out `GET /api/receipts` returned 500 and the
log showed `Module not found: Can't resolve
'.../apps/web/packages/services/src/ocr-worker.cjs'`; with `next dev` it
returned 401 with `{"error":{"code":"UNAUTHENTICATED",...}}`. After
`pnpm build` on the fix branch, the parse route's trace
(`.next/server/app/api/receipts/[id]/parse/route.js.nft.json`) listed
`packages/services/src/ocr-worker.cjs`, `pnpm-workspace.yaml`, 160
`tesseract.js` files and 44 `tesseract.js-core` files; the listing and image
routes' traces did not include the worker.

The default test command still failed after stopping the development server.
Passing both the isolated migration tests and the full web suite with one
worker supports resource contention during PGlite setup as an explanation,
but does not prove its precise cause. Default parallel-test reliability
remains unresolved and is separate from the receipt compilation fix.

Other errors encountered during verification had distinct causes: Auth.js
reported `MissingSecret` until local authentication was configured; a literal
`RECEIPT_ID` image URL returned 404; and opening the parse endpoint as a page
sent GET and returned 405. Using a real receipt ID and an authenticated POST
from the running application's origin completed the workflow.
