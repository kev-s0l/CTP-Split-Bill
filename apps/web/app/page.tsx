// Boilerplate home page. Shows the current dev user and a link to the health
// check endpoint. Example branches replace this with their own app-specific UI.
import { currentUserId } from "@project/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await currentUserId();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Starter Skeleton</h1>
        <p className="text-sm text-ink-muted">
          Signed in as <code className="rounded bg-canvas px-1">{userId}</code> (dev
          identity stub — real auth arrives in Week 8)
        </p>
      </header>

      <section className="rounded-card border border-line bg-surface p-6">
        <p className="mb-4 text-ink-muted">
          Welcome to the starter skeleton. The database is connected and ready.
          Example branches add their own pages, API routes, and background workers here.
        </p>
        <a
          href="/api/health"
          className="text-accent underline underline-offset-2 hover:opacity-80"
        >
          Check health &rarr;
        </a>
      </section>
    </div>
  );
}