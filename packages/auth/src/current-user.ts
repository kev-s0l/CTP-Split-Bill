// Resolve identity exclusively from the authenticated database session.
import { auth } from "./auth";

export async function currentUserId(): Promise<string> {
  const session = await auth();
  return session?.user?.id ?? "";
}
