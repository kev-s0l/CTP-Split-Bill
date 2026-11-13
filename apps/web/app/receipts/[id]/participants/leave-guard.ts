// Unsaved-changes guard for the participants editor. A full page unload gets
// the browser's own prompt via beforeunload. Sign out is a server-action form
// that navigates without unloading, so form submits are confirmed too; the
// editor itself has no forms, so every submit while dirty leaves the draft.
// Spec: docs/specs/receipts/participants-screen.md, "Editing the roster".
export const LEAVE_MESSAGE = "You have unsaved changes to the people on this receipt. Leave anyway?";

export function installLeaveGuard(
  target: EventTarget,
  confirmLeave: (message: string) => boolean,
): () => void {
  const onBeforeUnload = (e: Event) => e.preventDefault();
  // Capture phase on the window runs before React's root listener, so a
  // cancelled submit never reaches the form action.
  const onSubmit = (e: Event) => {
    if (confirmLeave(LEAVE_MESSAGE)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  target.addEventListener("beforeunload", onBeforeUnload);
  target.addEventListener("submit", onSubmit, { capture: true });
  return () => {
    target.removeEventListener("beforeunload", onBeforeUnload);
    target.removeEventListener("submit", onSubmit, { capture: true });
  };
}
