"use client";
// The finalize button, the pause-then-confirm flow and the confirmation dialog.
// Spec: docs/specs/receipts/finalize-screen.md, "Finalizing".
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { confirmationText } from "./summary";

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

export type FinalizePanelProps = {
  receiptId: string;
  revision: number;
  pickingOpen: boolean;
  // Why Finalize is unavailable, or null when it can be pressed.
  disabledReason: string | null;
  billCount: number;
  total: string;
};

type RequestError = { message: string; conflict: boolean };

async function requestError(res: Response): Promise<RequestError> {
  let message = "Something went wrong. Try again.";
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    message = body.error?.message ?? message;
  } catch {
    // Keep the generic message.
  }
  return { message, conflict: res.status === 409 };
}

async function post(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export function FinalizePanel({ receiptId, revision, pickingOpen, disabledReason, billCount, total }: FinalizePanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);
  const [openAfterRefresh, setOpenAfterRefresh] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const base = `/api/receipts/${encodeURIComponent(receiptId)}`;

  // After pausing, open the confirmation only once the refreshed amounts are in.
  useEffect(() => {
    if (openAfterRefresh && !refreshing) {
      setOpenAfterRefresh(false);
      if (disabledReason === null) setOpen(true);
    }
  }, [openAfterRefresh, refreshing, disabledReason]);

  async function start() {
    setError(null);
    if (!pickingOpen) {
      setOpen(true);
      return;
    }
    setBusy(true);
    const res = await post(`${base}/picking`, { open: false });
    setBusy(false);
    if (!res) return setError({ message: NETWORK_ERROR, conflict: false });
    if (!res.ok) return setError(await requestError(res));
    setOpenAfterRefresh(true);
    startRefresh(() => router.refresh());
  }

  async function finalize() {
    setBusy(true);
    const res = await post(`${base}/finalize`, { expectedRevision: revision });
    if (res?.ok) {
      toast.success("Receipt finalized");
      router.push("/");
      return;
    }
    setBusy(false);
    setOpen(false);
    setError(res ? await requestError(res) : { message: NETWORK_ERROR, conflict: false });
  }

  function reload() {
    setError(null);
    startRefresh(() => router.refresh());
  }

  const working = busy || refreshing;
  const label = pickingOpen ? "Pause picking and finalize" : "Finalize";

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{error.message}</p>
          {error.conflict && (
            <Button type="button" variant="outline" className="min-h-11" onClick={reload} disabled={working}>
              Reload
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col items-stretch gap-1 sm:items-end">
        <Button
          type="button"
          className="min-h-11 sm:min-w-40"
          onClick={start}
          disabled={disabledReason !== null || working}
          aria-describedby={disabledReason ? "finalize-disabled-reason" : undefined}
        >
          {label}
        </Button>
        {disabledReason && (
          <p id="finalize-disabled-reason" className="text-sm text-ink-muted">
            {disabledReason}
          </p>
        )}
      </div>

      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent onEscapeKeyDown={(e) => busy && e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this receipt?</AlertDialogTitle>
            <AlertDialogDescription>{confirmationText(billCount, total)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog open until the request settles.
                e.preventDefault();
                void finalize();
              }}
            >
              Finalize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
