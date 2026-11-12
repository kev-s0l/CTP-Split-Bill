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

`recognizeReceipt` now starts the worker through a small `forkWorker(file,
options)` helper in `packages/services/src/ocr.ts`. Inside the helper, the
`fork()` argument is a plain parameter, so Turbopack has no partly constant
path to resolve and leaves it to runtime. The worker path is still computed at
runtime from the workspace root, exactly as before, and the dev server keeps
`next dev --turbopack`.

Two other approaches were tried first. A `/* turbopackIgnore: true */`
comment on the `fork()` argument had no effect on Next.js 15.5.21: the route
still failed with the same resolution error. Switching the dev script to
webpack (`next dev`) worked, but only by not running Turbopack, and a Next.js
upgrade that makes Turbopack the default would have brought the failure back.

## Why our defenses missed it

Route tests invoke handlers through Vitest with external seams mocked. The OCR
unit tests also mock `fork()`, and the opt-in real OCR drill runs through
Vitest. These tests exercise application behavior without compiling routes
through the Next.js development bundler.

`pnpm build` exercises webpack, so it does not cover the Turbopack-specific
failure either. The missing defense was an actual authenticated receipt
workflow against the development server.

## What changed beyond the fix

The web spec now documents the worker-path constraint and the parse route's
worker trace, and its Verify section gains a development-server receipt drill
and a build-trace check. `apps/web/README.md` explains why the worker is
started through the helper. No automated regression test was added: the
failure only appears when the Next.js dev bundler compiles a route, which
Vitest does not do, so the dev-server drill is the defense.

`packages/services/src/index.ts` still re-exports the OCR adapter, so every
route importing `@project/services` still includes `ocr.ts`. That is harmless
now that the `fork()` call compiles; narrowing the export is a separate
change.

Verification of the helper fix, on the fix branch:

| Check | Observed result |
|---|---|
| `next dev --turbopack`, signed-out `GET /api/receipts` | 401 `UNAUTHENTICATED` (500 with the resolution error before the fix) |
| `next dev --turbopack`, signed-out `POST /api/receipts/<id>/parse` | 401 `UNAUTHENTICATED` |
| Temporary route calling `recognizeReceipt` on `apps/web/tests/fixtures/receipt-ocr.png`, under `next dev --turbopack` and under webpack `next dev` | 200 with the fixture's full text (Soup 10.00, Tea 3.00, Total 16.00) in both; the route was removed afterwards |
| `RECEIPT_OCR_DRILL=1` real OCR drill | Passed |
| `pnpm test` | Passed: domain 42, services 35, web 329 (two opt-in drills skipped) |
| `pnpm typecheck`, `pnpm build` | Passed |
| Parse route build trace | Lists `ocr-worker.cjs`, `pnpm-workspace.yaml`, 160 `tesseract.js` and 44 `tesseract.js-core` files |

The developer supplied the following results earlier, with the dev script
switched to webpack (the first approach):

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
results were not independently inspected in that run. A production-runtime
parse (`next start`) has not been checked with either approach.

On the developer's machine the default test command failed on a 10-second
migration-test setup timeout, even with the development server stopped;
passing both the isolated migration tests and the single-worker suite points
to resource contention during PGlite setup, but its precise cause is
unconfirmed. The default `pnpm test` passed on the reviewer's machine. This is
separate from the receipt compilation fix.

Other errors encountered during verification had distinct causes: Auth.js
reported `MissingSecret` until local authentication was configured; a literal
`RECEIPT_ID` image URL returned 404; and opening the parse endpoint as a page
sent GET and returned 405. Using a real receipt ID and an authenticated POST
from the running application's origin completed the workflow.
