// Root layout for the Next.js app. Wraps every page with the app shell (header
// + content column) and global styles. No layout logic — just structure and
// metadata. Shell and tokens: docs/specs/components.md.
import type { Metadata } from "next";
// import "./globals.css";

export const metadata: Metadata = {
  title: "Split Bill",
  description: "Split a receipt and see who owes what.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-2xl items-center px-4 py-3">
            <a href="/" className="text-lg font-semibold">
              Split Bill
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
