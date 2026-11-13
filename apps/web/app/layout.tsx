// Root layout for the Next.js app. Wraps every page with the app shell: the
// header and its account slot, the content column, and the toast host.
// Shell and tokens: docs/specs/components.md.
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { currentUserId, signOut } from "@project/auth";
import { getCurrentUser } from "@project/domain";
import { log } from "@project/log";
import { UserMenu } from "./components/UserMenu";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Split Bill",
  description: "Split a receipt and see who owes what.",
};

// Revokes the database session, then returns to the landing page.
async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

// Streams in on its own so no page waits on the profile read. A failed read
// still renders the menu, so sign-out stays reachable.
async function AccountSlot() {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch (error) {
    unstable_rethrow(error);
    log.error({ err: error }, "header session read failed");
    return null;
  }
  if (!userId) return null;

  let name = "Account";
  try {
    name = (await getCurrentUser(userId)).name;
  } catch (error) {
    unstable_rethrow(error);
    log.error({ err: error }, "header profile read failed");
  }
  return <UserMenu name={name} signOutAction={signOutAction} />;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-2">
            <a href="/" className="inline-flex min-h-11 items-center text-lg font-semibold">
              Split Bill
            </a>
            <Suspense fallback={<Skeleton className="h-11 w-24" />}>
              <AccountSlot />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
