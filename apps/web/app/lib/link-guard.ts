// Holds in-app link clicks while a form has unsaved changes, so the screen can
// ask first (docs/specs/receipts/edit-screen.md, "Leaving with unsaved
// changes"). Next.js links move between pages without unloading the page, so
// the browser's own beforeunload prompt never sees them.

export type LinkInfo = { href: string; target: string | null; download: boolean };
export type ClickInfo = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

// Where the click would take the user inside this site, or null when it
// should go ahead untouched: another tab or window, a download, a modified
// click, another site (the browser's own prompt covers leaving the site), or
// the same page (an in-page anchor).
export function linkLeavesPage(link: LinkInfo, click: ClickInfo, here: string): string | null {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (link.download || (link.target && link.target !== "_self")) return null;
  const current = new URL(here);
  let to: URL;
  try {
    to = new URL(link.href, current);
  } catch {
    return null;
  }
  if (to.origin !== current.origin) return null;
  if (to.pathname === current.pathname && to.search === current.search) return null;
  return `${to.pathname}${to.search}${to.hash}`;
}

// Listens in the capture phase on the document, ahead of React and Next.js's
// own link handling, and stops a leaving click before it navigates.
export function installLinkGuard(doc: Document, onHeld: (href: string) => void): () => void {
  const onClick = (e: MouseEvent) => {
    const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = linkLeavesPage(
      { href: anchor.getAttribute("href") ?? "", target: anchor.getAttribute("target"), download: anchor.hasAttribute("download") },
      e,
      doc.location.href,
    );
    if (href === null) return;
    e.preventDefault();
    e.stopPropagation();
    onHeld(href);
  };
  doc.addEventListener("click", onClick, { capture: true });
  return () => doc.removeEventListener("click", onClick, { capture: true });
}
