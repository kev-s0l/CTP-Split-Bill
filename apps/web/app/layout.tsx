// Root layout for the Next.js app. Wraps every page with the HTML shell and
// global styles. No layout logic — just structure and metadata.
import type { Metadata } from "next";
import "./globals.css";
import "./splitbill.css";

export const metadata: Metadata = {
  title: "Starter Skeleton",
  description: "C12 Fall 2026 — every layer exists; the weeks make them deep.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
        />
      </head>
      <body className="mx-auto max-w-2xl px-4 py-10">
        {children}
      </body>
    </html>
  );
}