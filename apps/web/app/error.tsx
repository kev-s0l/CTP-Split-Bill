"use client";
// Root error boundary (docs/specs/components.md, "The shell"). Shows generic
// copy only: the error's message never reaches the screen. Retry refetches
// the server data, then resets the boundary.
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { ErrorState } from "./components/ErrorState";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <ErrorState
      title="Something went wrong"
      message="This page didn't load. Try again in a moment."
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
