"use client";
// The header's account menu (docs/specs/components.md, "UserMenu"). Opening,
// focus and keyboard movement come from the Radix primitive. Its one handler
// keeps the menu open on "Sign out": closing it would unmount the form before
// the browser submits it, and the submission would be dropped.
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function UserMenu({
  name,
  signOutAction,
}: {
  name: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="min-h-11 max-w-40 sm:max-w-60">
          <span className="truncate">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal text-ink-muted">
          Signed in as
          <span className="block truncate font-medium text-ink">{name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem
            asChild
            className="min-h-11 w-full"
            onSelect={(event) => event.preventDefault()}
          >
            <button type="submit">Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
