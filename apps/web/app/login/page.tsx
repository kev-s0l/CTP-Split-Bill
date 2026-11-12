// Sign-in page: a centered card telling signed-out visitors to continue with
// GitHub. Middleware sends signed-in visitors away from this page.
import type { Metadata } from "next";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/app/components/ui/card";
import { safeCallbackPath } from "@/app/lib/page-access";
import { signInWithGitHub } from "./actions";

export const metadata: Metadata = { title: "Sign in · Split Bill" };

// Auth.js error codes arrive as ?error=; unknown codes get the generic message.
const ERRORS: Record<string, string> = {
  AccessDenied: "GitHub didn't share a verified email address. Verify an email in your GitHub settings, then try again.",
};
const GENERIC_ERROR = "Sign-in didn't complete. Please try again.";

type SearchParams = Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(first(params.callbackUrl));
  const errorCode = first(params.error);
  const error = errorCode ? (ERRORS[errorCode] ?? GENERIC_ERROR) : null;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to Split Bill</CardTitle>
          <CardDescription>You need to sign in with GitHub to continue.</CardDescription>
        </CardHeader>
        {error && (
          <CardContent>
            <p role="alert" className="text-sm text-destructive">{error}</p>
          </CardContent>
        )}
        <CardFooter>
          <form action={signInWithGitHub.bind(null, callbackPath)} className="w-full">
            <Button type="submit" size="lg" className="w-full">Continue with GitHub</Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
