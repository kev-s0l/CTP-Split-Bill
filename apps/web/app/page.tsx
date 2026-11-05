// Public landing page with a link to the health check endpoint.

export default function Home() {
  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Starter Skeleton</h1>
        <p className="text-sm text-neutral-500">A place to organize shared receipt splits.</p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
        <p className="mb-4 text-neutral-600">
          Welcome to the starter skeleton. The database is connected and ready.
          Example branches add their own pages, API routes, and background workers here.
        </p>
        <a
          href="/api/health"
          className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
        >
          Check health &rarr;
        </a>
      </section>
    </main>
  );
}
