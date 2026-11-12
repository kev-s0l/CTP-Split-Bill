"use server";
// Starts GitHub OAuth from the sign-in card. Auth.js redirects to GitHub and,
// after authorization, back to the sanitized callback path.
import { signIn } from "@project/auth";
import { safeCallbackPath } from "@/app/lib/page-access";

export async function signInWithGitHub(callbackPath: string) {
  await signIn("github", { redirectTo: safeCallbackPath(callbackPath) });
}
