"use client";

import { useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <Card><CardContent className="space-y-4 pt-6"><p role="alert">Could not load your bills.</p><Button onClick={reset}>Try again</Button></CardContent></Card>;
}
