"use client";
// Roster editor and pick-link actions for the participants screen: one compact
// row per person, tap to edit. Spec: docs/specs/receipts/participants-screen.md.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "../../../components/EmptyState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { mailtoHref, pickLinkMessage, smsHref } from "../../../lib/pick-link-share";
import {
  type EditorReceipt,
  type FieldErrors,
  type Row,
  type SavedParticipant,
  MAX_PARTICIPANTS,
  canSave,
  contactSummary,
  fieldErrors,
  hasErrors,
  isDirty,
  isReadOnly,
  placeholderName,
  rosterRequest,
  rowsFrom,
  toEditorReceipt,
} from "./roster";
import { installLeaveGuard } from "./leave-guard";

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

type Touched = Record<string, { phone?: boolean; email?: boolean }>;
type SaveError = { message: string; conflict: boolean };
type Focus = { kind: "name"; key: string } | { kind: "add" } | null;

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? "Something went wrong. Try again.";
  } catch {
    return "Something went wrong. Try again.";
  }
}

export function ParticipantsEditor({ initial }: { initial: EditorReceipt }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(initial.participants));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [touched, setTouched] = useState<Touched>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  // Per participant, so one finished request never re-enables another row.
  const [linkPending, setLinkPending] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<Focus>(null);
  const nextKey = useRef(0);
  const removeLeaveGuard = useRef<(() => void) | null>(null);

  const readOnly = isReadOnly(saved);
  const dirty = isDirty(rows, saved.participants);
  const savedById = new Map(saved.participants.map((p) => [p.id, p]));

  useEffect(() => {
    if (!dirty) return;
    const remove = installLeaveGuard(window, (message) => window.confirm(message));
    removeLeaveGuard.current = remove;
    return () => {
      remove();
      removeLeaveGuard.current = null;
    };
  }, [dirty]);

  useEffect(() => {
    if (!focus) return;
    // With the last row removed, Add person lives in the empty state.
    const target =
      focus.kind === "name"
        ? document.getElementById(`${focus.key}-name`)
        : (document.getElementById("add-person") ?? document.querySelector<HTMLElement>("#roster-empty button"));
    target?.focus();
    setFocus(null);
  }, [focus]);

  function visibleErrors(row: Row): FieldErrors {
    const all = fieldErrors(row);
    if (showAllErrors) return all;
    const t = touched[row.key] ?? {};
    return { phone: t.phone ? all.phone : undefined, email: t.email ? all.email : undefined };
  }

  function addRow() {
    if (rows.length >= MAX_PARTICIPANTS) return;
    const key = `new-${nextKey.current++}`;
    setRows((r) => [...r, { key, displayName: "", phone: "", email: "" }]);
    setExpanded(key);
    setFocus({ kind: "name", key });
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    if (expanded === key) setExpanded(null);
    setFocus({ kind: "add" });
  }

  async function save() {
    setShowAllErrors(true);
    const firstBad = rows.find((row) => hasErrors(fieldErrors(row)));
    if (firstBad) {
      setExpanded(firstBad.key);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/receipts/${saved.id}/participants`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rosterRequest(rows, saved.revision)),
      });
      if (!res.ok) {
        setSaveError({ message: await errorMessage(res), conflict: res.status === 409 });
        return;
      }
      const next = toEditorReceipt(await res.json());
      setSaved(next);
      setRows(rowsFrom(next.participants));
      setExpanded(null);
      setTouched({});
      setShowAllErrors(false);
      toast.success("Saved");
      // Re-reads the layout so the step bar reflects the saved roster.
      router.refresh();
    } catch {
      setSaveError({ message: NETWORK_ERROR, conflict: false });
    } finally {
      setSaving(false);
    }
  }

  function reload() {
    removeLeaveGuard.current?.();
    window.location.reload();
  }

  async function issueLink(participantId: string) {
    if (linkPending.has(participantId)) return;
    setLinkPending((s) => new Set(s).add(participantId));
    setLinkErrors(({ [participantId]: _omit, ...rest }) => rest);
    try {
      const res = await fetch(`/api/receipts/${saved.id}/participants/${participantId}/pick-link`, {
        method: "POST",
      });
      if (!res.ok) {
        const message = await errorMessage(res);
        setLinkErrors((e) => ({ ...e, [participantId]: message }));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      setLinks((l) => ({ ...l, [participantId]: url }));
      setSaved((s) => ({
        ...s,
        participants: s.participants.map((p) => (p.id === participantId ? { ...p, hasPickLink: true } : p)),
      }));
    } catch {
      setLinkErrors((e) => ({ ...e, [participantId]: NETWORK_ERROR }));
    } finally {
      setLinkPending((s) => {
        const next = new Set(s);
        next.delete(participantId);
        return next;
      });
    }
  }

  const readOnlyNote =
    saved.status === "FINALIZED"
      ? "This receipt is finalized, so the people on it can't change. Their links now show the split."
      : saved.parseStatus === "PARSING"
        ? "This receipt is still being scanned. You can edit people once it finishes."
        : null;

  // A disabled fieldset locks every field and button while a save is in
  // flight, so nothing typed then is overwritten by the saved response.
  return (
    <fieldset disabled={saving} aria-busy={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
      {readOnly && readOnlyNote && <p className="text-ink-muted">{readOnlyNote}</p>}

      {rows.length === 0 ? (
        readOnly ? (
          <p className="text-ink-muted">No one&apos;s on this receipt yet.</p>
        ) : (
          <div id="roster-empty">
            <EmptyState
              title="No one's on this receipt yet"
              message="Add the people splitting it. Names can wait; everyone starts as a guest."
              actionLabel="Add person"
              onAction={addRow}
            />
          </div>
        )
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-line">
            {rows.map((row, index) => (
              <li key={row.key}>
                <ParticipantRow
                  row={row}
                  index={index}
                  stored={row.id ? savedById.get(row.id) : undefined}
                  readOnly={readOnly}
                  expanded={expanded === row.key}
                  onToggle={() => setExpanded((k) => (k === row.key ? null : row.key))}
                  errors={visibleErrors(row)}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onBlur={(field) =>
                    setTouched((t) => ({ ...t, [row.key]: { ...t[row.key], [field]: true } }))
                  }
                  onRemove={() => removeRow(row.key)}
                  link={row.id ? links[row.id] : undefined}
                  linkError={row.id ? linkErrors[row.id] : undefined}
                  linkPending={row.id !== undefined && linkPending.has(row.id)}
                  onIssueLink={() => row.id && issueLink(row.id)}
                  merchantName={saved.merchantName}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!readOnly && (
        <div className="space-y-3">
          {saveError && (
            <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-destructive">
              <p>{saveError.message}</p>
              {saveError.conflict && (
                <Button type="button" variant="outline" className="min-h-11" onClick={reload}>
                  Reload
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {rows.length > 0 ? (
              <Button
                id="add-person"
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={addRow}
                disabled={rows.length >= MAX_PARTICIPANTS}
              >
                + Add person
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" className="min-h-11 min-w-24" onClick={save} disabled={!canSave(rows, dirty, saving)}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {rows.length >= MAX_PARTICIPANTS && (
            <p className="text-sm text-ink-muted">A receipt can have up to {MAX_PARTICIPANTS} people.</p>
          )}
        </div>
      )}
    </fieldset>
  );
}

type RowProps = {
  row: Row;
  index: number;
  stored: SavedParticipant | undefined;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  errors: FieldErrors;
  onChange: (patch: Partial<Row>) => void;
  onBlur: (field: "phone" | "email") => void;
  onRemove: () => void;
  link: string | undefined;
  linkError: string | undefined;
  linkPending: boolean;
  onIssueLink: () => void;
  merchantName: string | null;
};

export function ParticipantRow({
  row,
  index,
  stored,
  readOnly,
  expanded,
  onToggle,
  errors,
  onChange,
  onBlur,
  onRemove,
  link,
  linkError,
  linkPending,
  onIssueLink,
  merchantName,
}: RowProps) {
  const [dialog, setDialog] = useState<"remove" | "resend" | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const label = row.displayName.trim() || placeholderName(index);
  const hasFieldError = hasErrors(errors);
  const status = !stored ? "Not saved" : stored.hasPickLink ? "Link sent" : "No link";
  const canResend = stored?.hasPickLink && !link && !linkPending;
  const summary = hasFieldError ? "Fix the phone or email" : contactSummary(row);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
          onClick={onToggle}
          disabled={readOnly}
          aria-expanded={readOnly ? undefined : expanded}
          aria-controls={readOnly ? undefined : `${row.key}-fields`}
        >
          <span className="truncate font-semibold">{label}</span>
          <span className={`truncate text-sm ${hasFieldError ? "text-destructive" : "text-ink-muted"}`}>{summary}</span>
        </button>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">{status}</span>
        {(!readOnly || canResend) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuButton}
                type="button"
                variant="ghost"
                className="min-h-11 min-w-11 shrink-0"
                aria-label={`More for ${label}`}
              >
                ⋯
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {!readOnly && (
                <DropdownMenuItem className="min-h-11" onSelect={onToggle}>
                  {expanded ? "Close" : "Edit"}
                </DropdownMenuItem>
              )}
              {canResend && (
                <DropdownMenuItem className="min-h-11" onSelect={() => setDialog("resend")}>
                  Send new link
                </DropdownMenuItem>
              )}
              {!readOnly && (
                <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setDialog("remove")}>
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && !readOnly && (
        <div id={`${row.key}-fields`} className="mt-3 grid gap-3 md:grid-cols-3">
          <Field id={`${row.key}-name`} label="Name">
            <Input
              id={`${row.key}-name`}
              className="min-h-11"
              value={row.displayName}
              placeholder={placeholderName(index)}
              maxLength={50}
              onChange={(e) => onChange({ displayName: e.target.value })}
            />
          </Field>
          <Field id={`${row.key}-phone`} label="Phone (optional)" error={errors.phone}>
            <Input
              id={`${row.key}-phone`}
              className="min-h-11"
              type="tel"
              autoComplete="off"
              value={row.phone}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? `${row.key}-phone-error` : undefined}
              onChange={(e) => onChange({ phone: e.target.value })}
              onBlur={() => onBlur("phone")}
            />
          </Field>
          <Field id={`${row.key}-email`} label="Email (optional)" error={errors.email}>
            <Input
              id={`${row.key}-email`}
              className="min-h-11"
              type="email"
              autoComplete="off"
              value={row.email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${row.key}-email-error` : undefined}
              onChange={(e) => onChange({ email: e.target.value })}
              onBlur={() => onBlur("email")}
            />
          </Field>
          <div className="md:col-span-3">
            <Button type="button" variant="outline" className="min-h-11" onClick={onToggle}>
              Done
            </Button>
          </div>
        </div>
      )}

      <PickLink
        rowKey={row.key}
        stored={stored}
        link={link}
        error={linkError}
        pending={linkPending}
        onIssue={onIssueLink}
        merchantName={merchantName}
      />

      <AlertDialog open={dialog === "remove"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Cancel returns to the menu button; after Remove the row is gone
            // and the editor moves focus to Add person.
            e.preventDefault();
            menuButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {stored?.hasPickLink
                ? "Their pick link will stop working once you save."
                : "They'll be removed from this receipt once you save."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "resend"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            menuButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Send {label} a new link?</AlertDialogTitle>
            <AlertDialogDescription>The link you sent before will stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onIssueLink}>
              Make new link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// Link actions under a row. Shown only when there is something to do: create a
// first link, or share one just made. Resending lives in the row's menu.
export function PickLink({
  rowKey,
  stored,
  link,
  error,
  pending,
  onIssue,
  merchantName,
}: {
  rowKey: string;
  stored: SavedParticipant | undefined;
  link: string | undefined;
  error: string | undefined;
  pending: boolean;
  onIssue: () => void;
  merchantName: string | null;
}) {
  if (!stored) return null;
  const linkFieldId = `${rowKey}-link`;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      const field = document.getElementById(linkFieldId) as HTMLInputElement | null;
      field?.focus();
      field?.select();
      toast.error("Couldn't copy. The link is selected so you can copy it yourself.");
    }
  }

  let body: React.ReactNode = null;
  if (link) {
    body = (
      <div className="space-y-2 rounded-md bg-muted p-3">
        <Label htmlFor={linkFieldId}>Pick link</Label>
        <Input id={linkFieldId} className="min-h-11 bg-background" readOnly value={link} onFocus={(e) => e.target.select()} />
        <p className="text-sm text-ink-muted">Shown once; sending again makes a new link.</p>
        <div className="flex flex-wrap gap-2">
          {stored.phone && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={smsHref(stored.phone, pickLinkMessage(link, merchantName))}>Text</a>
            </Button>
          )}
          {stored.email && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={mailtoHref(stored.email, pickLinkMessage(link, merchantName))}>Email</a>
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" onClick={() => copy(link)}>
            Copy link
          </Button>
        </div>
      </div>
    );
  } else if (!stored.hasPickLink) {
    body = (
      <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onIssue}>
        {pending ? "Making link…" : "Create link"}
      </Button>
    );
  } else if (pending) {
    body = <p className="text-sm text-ink-muted">Making link…</p>;
  }

  if (!body && !error) return null;
  return (
    <div className="mt-2 space-y-2">
      {body}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
