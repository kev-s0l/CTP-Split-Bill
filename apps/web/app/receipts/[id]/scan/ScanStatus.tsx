"use client";
// The Scan step: starts reading the photo, polls while a read is running, and
// shows each outcome. Spec: docs/specs/receipts/upload-screen.md, "Scan".
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { loginPath } from "../../../lib/page-access";
import { ScanPanel } from "./ScanPanel";
import {
  POLL_MS,
  type ScanReceipt,
  type ScanView,
  parseOutcome,
  toScanReceipt,
  viewFor,
} from "./scan-state";

export function ScanStatus({ initial }: { initial: ScanReceipt }) {
  const router = useRouter();
  const [receipt, setReceipt] = useState(initial);
  const [view, setView] = useState<ScanView>(() => {
    const v = viewFor(initial, Date.now());
    return v.kind === "start" ? { kind: "reading" } : v;
  });
  const started = useRef(false);
  const base = `/receipts/${encodeURIComponent(initial.id)}`;

  const goToLogin = useCallback(() => window.location.assign(loginPath(`${base}/scan`)), [base]);

  // Reads the receipt again; null when that fails.
  const reload = useCallback(async (): Promise<ScanReceipt | null> => {
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(initial.id)}`, { cache: "no-store" });
      if (res.status === 401) {
        goToLogin();
        return null;
      }
      if (!res.ok) return null;
      const next = toScanReceipt(await res.json());
      setReceipt(next);
      return next;
    } catch {
      return null;
    }
  }, [initial.id, goToLogin]);

  const show = useCallback(
    (next: ScanReceipt) => {
      const v = viewFor(next, Date.now());
      setView(v.kind === "start" ? { kind: "failed", reason: "error" } : v);
      if (v.kind !== "reading") router.refresh();
    },
    [router],
  );

  const startParse = useCallback(
    async (revision: number) => {
      setView({ kind: "reading" });
      let status: number;
      try {
        const res = await fetch(`/api/receipts/${encodeURIComponent(initial.id)}/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: revision }),
        });
        status = res.status;
      } catch {
        setView({ kind: "failed", reason: "error" });
        return;
      }
      const outcome = parseOutcome(status);
      if (outcome.kind === "items") {
        router.replace(`${base}/items`);
      } else if (outcome.kind === "login") {
        goToLogin();
      } else if (outcome.kind === "reload") {
        const next = await reload();
        if (next) show(next);
        else setView({ kind: "failed", reason: "error" });
      } else {
        setView({ kind: "failed", reason: outcome.reason });
        router.refresh();
      }
    },
    [initial.id, base, router, goToLogin, reload, show],
  );

  // One parse per visit. The ref survives React's development double-mount,
  // so only one request is sent; a reload mid-parse finds PARSING and polls.
  useEffect(() => {
    if (started.current || initial.parseStatus !== "NOT_STARTED") return;
    started.current = true;
    void startParse(initial.revision);
  }, [initial.parseStatus, initial.revision, startParse]);

  // Poll only while another request is reading this receipt.
  const polling = view.kind === "reading" && receipt.parseStatus === "PARSING";
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      const next = await reload();
      // Stops on a new status, or once the read counts as abandoned.
      if (next && viewFor(next, Date.now()).kind !== "reading") show(next);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, reload, show]);

  async function tryAgain() {
    const next = await reload();
    if (next) await startParse(next.revision);
    else setView({ kind: "failed", reason: "error" });
  }

  return <ScanPanel view={view} itemsHref={`${base}/items`} onTryAgain={tryAgain} />;
}
