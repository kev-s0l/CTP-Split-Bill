// Public landing page with a link to the health check endpoint.

export default function Home() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Starter Skeleton</h1>
        <p className="text-sm text-neutral-500">A place to organize shared receipt splits.</p>
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
