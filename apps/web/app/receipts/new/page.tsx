// Start a receipt from a photo. No step bar: there is no receipt yet.
// Spec: docs/specs/receipts/upload-screen.md. Signed-out visitors are sent to
// sign in by the middleware (auth/sign-in.md).
import { UploadForm } from "./UploadForm";

export default function NewReceiptPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">New receipt</h1>
        <p className="text-ink-muted">Take a photo of the receipt, or choose one you already have.</p>
      </header>
      <UploadForm />
    </div>
  );
}
