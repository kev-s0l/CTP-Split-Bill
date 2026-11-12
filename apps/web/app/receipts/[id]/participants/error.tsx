"use client";
// Error boundary for the participants screen. Generic copy only; retry
// refetches the server data, then resets the boundary.
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { ErrorState } from "../../../components/ErrorState";

export default function ParticipantsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <ErrorState
      title="People didn't load"
      message="Something went wrong loading this receipt. Try again in a moment."
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
