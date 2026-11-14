"use client";
// Receipt photo upload: Take photo / Choose from library, a preview to
// confirm, then shrink and upload. Spec: docs/specs/receipts/upload-screen.md.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { Button } from "../../components/ui/button";
import { loginPath } from "../../lib/page-access";
import { shrinkPhoto } from "./shrink-photo";
import { ACCEPT_ATTR, MESSAGES, initialUploadState, uploadOutcome, uploadReducer } from "./upload";

export function UploadForm() {
  const router = useRouter();
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const file = state.phase === "choose" ? null : state.file;
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { if (state.error) errorRef.current?.focus(); }, [state.error]);

  function onChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (chosen) dispatch({ type: "chose", file: chosen });
  }

  async function scan() {
    if (!file) return;
    dispatch({ type: "preparing" });
    const photo = await shrinkPhoto(file);
    if (!photo) {
      dispatch({ type: "failed", error: MESSAGES.tooLarge });
      return;
    }
    dispatch({ type: "uploading" });
    const body = new FormData();
    body.append("file", photo);
    let res: Response;
    try {
      res = await fetch("/api/receipts", { method: "POST", body });
    } catch {
      dispatch({ type: "failed", error: MESSAGES.network });
      return;
    }
    const outcome = uploadOutcome(res.status, await res.json().catch(() => null));
    if (outcome.kind === "scan") router.push(`/receipts/${encodeURIComponent(outcome.receiptId)}/scan`);
    else if (outcome.kind === "login") window.location.assign(loginPath("/receipts/new"));
    else dispatch({ type: "failed", error: outcome.message });
  }

  const busy = state.phase === "preparing" || state.phase === "uploading";

  return (
    <div className="space-y-4">
      {state.error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive p-3 text-destructive">
          {state.error}
        </p>
      )}

      {state.phase === "choose" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" className="hidden min-h-11 pointer-coarse:inline-flex" onClick={() => cameraInput.current?.click()}>
            Take photo
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => libraryInput.current?.click()}>
            Choose from library
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {previewUrl && (
            // Object URLs aren't optimizable by next/image; a plain img is the preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Receipt photo preview"
              className="mx-auto max-h-[60vh] w-full rounded-card border border-line bg-surface object-contain"
            />
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" className="min-h-11" onClick={scan} disabled={busy}>
              {state.phase === "preparing" ? "Preparing photo…" : state.phase === "uploading" ? "Uploading…" : "Scan this receipt"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => dispatch({ type: "chooseAgain" })} disabled={busy}>
              Choose a different photo
            </Button>
          </div>
        </div>
      )}

      <input ref={cameraInput} type="file" accept={ACCEPT_ATTR} capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={onChosen} data-input="camera" />
      <input ref={libraryInput} type="file" accept={ACCEPT_ATTR} className="hidden" tabIndex={-1} aria-hidden="true" onChange={onChosen} data-input="library" />
    </div>
  );
}
