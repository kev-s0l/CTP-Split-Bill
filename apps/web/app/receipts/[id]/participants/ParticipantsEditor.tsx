"use client";
// Roster editor and pick-link actions for the participants screen.
// Spec: docs/specs/receipts/participants-screen.md.
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
  AlertDialogTrigger,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { mailtoHref, pickLinkMessage, smsHref } from "../../../lib/pick-link-share";
import {
  type EditorReceipt,
  type FieldErrors,
  type Row,
  type SavedParticipant,
  MAX_PARTICIPANTS,
  fieldErrors,
  hasErrors,
  isDirty,
  isReadOnly,
  placeholderName,
  rosterRequest,
  rowsFrom,
  toEditorReceipt,
} from "./roster";

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
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(initial.participants));
  const [touched, setTouched] = useState<Touched>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const [linkPending, setLinkPending] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const nextKey = useRef(0);
  const allowLeave = useRef(false);

  const readOnly = isReadOnly(saved);
  const dirty = isDirty(rows, saved.participants);
  const savedById = new Map(saved.participants.map((p) => [p.id, p]));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!focus) return;
    const id = focus.kind === "name" ? `${focus.key}-name` : "add-person";
    document.getElementById(id)?.focus();
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
    setFocus({ kind: "name", key });
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    setFocus({ kind: "add" });
  }

  async function save() {
    setShowAllErrors(true);
    if (rows.some((row) => hasErrors(fieldErrors(row)))) return;
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
      setTouched({});
      setShowAllErrors(false);
      toast.success("Saved");
    } catch {
      setSaveError({ message: NETWORK_ERROR, conflict: false });
    } finally {
      setSaving(false);
    }
  }

  function reload() {
    allowLeave.current = true;
    window.location.reload();
  }

  async function issueLink(participantId: string) {
    setLinkPending(participantId);
    setLinkErrors(({ [participantId]: _, ...rest }) => rest);
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
      setLinkPending(null);
    }
  }

  const readOnlyNote =
    saved.status === "FINALIZED"
      ? "This receipt is finalized, so the people on it can't change. Their links now show the split."
      : saved.parseStatus === "PARSING"
        ? "This receipt is still being scanned. You can edit people once it finishes."
        : null;

  return (
    <div className="space-y-4">
      {readOnly && readOnlyNote && <p className="text-ink-muted">{readOnlyNote}</p>}

      {rows.length === 0 ? (
        readOnly ? (
          <p className="text-ink-muted">No one&apos;s on this receipt yet.</p>
        ) : (
          <EmptyState
            title="No one's on this receipt yet"
            message="Add the people splitting it. Names can wait; everyone starts as a guest."
            actionLabel="Add person"
            onAction={addRow}
          />
        )
      ) : (
        <ol className="space-y-4">
          {rows.map((row, index) => (
            <li key={row.key}>
              <ParticipantCard
                row={row}
                index={index}
                stored={row.id ? savedById.get(row.id) : undefined}
                readOnly={readOnly}
                errors={visibleErrors(row)}
                onChange={(patch) => updateRow(row.key, patch)}
                onBlur={(field) =>
                  setTouched((t) => ({ ...t, [row.key]: { ...t[row.key], [field]: true } }))
                }
                onRemove={() => removeRow(row.key)}
                link={row.id ? links[row.id] : undefined}
                linkError={row.id ? linkErrors[row.id] : undefined}
                linkPending={row.id !== undefined && linkPending === row.id}
                onIssueLink={() => row.id && issueLink(row.id)}
                merchantName={saved.merchantName}
              />
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <div className="space-y-4">
          {rows.length > 0 && (
            <div className="space-y-1">
              <Button
                id="add-person"
                type="button"
                variant="outline"
                className="min-h-11 w-full md:w-auto"
                onClick={addRow}
                disabled={rows.length >= MAX_PARTICIPANTS}
              >
                Add person
              </Button>
              {rows.length >= MAX_PARTICIPANTS && (
                <p className="text-sm text-ink-muted">A receipt can have up to {MAX_PARTICIPANTS} people.</p>
              )}
            </div>
          )}

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

          <Button
            type="button"
            className="min-h-11 w-full md:w-auto"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ParticipantCard({
  row,
  index,
  stored,
  readOnly,
  errors,
  onChange,
  onBlur,
  onRemove,
  link,
  linkError,
  linkPending,
  onIssueLink,
  merchantName,
}: {
  row: Row;
  index: number;
  stored: SavedParticipant | undefined;
  readOnly: boolean;
  errors: FieldErrors;
  onChange: (patch: Partial<Row>) => void;
  onBlur: (field: "phone" | "email") => void;
  onRemove: () => void;
  link: string | undefined;
  linkError: string | undefined;
  linkPending: boolean;
  onIssueLink: () => void;
  merchantName: string | null;
}) {
  const label = row.displayName.trim() || placeholderName(index);
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{label}</h2>
          {!readOnly && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="min-h-11 min-w-11">
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
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
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field id={`${row.key}-name`} label="Name">
            <Input
              id={`${row.key}-name`}
              className="min-h-11"
              value={row.displayName}
              placeholder={placeholderName(index)}
              maxLength={50}
              disabled={readOnly}
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
              disabled={readOnly}
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
              disabled={readOnly}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${row.key}-email-error` : undefined}
              onChange={(e) => onChange({ email: e.target.value })}
              onBlur={() => onBlur("email")}
            />
          </Field>
        </div>

        <PickLink
          rowKey={row.key}
          stored={stored}
          link={link}
          error={linkError}
          pending={linkPending}
          onIssue={onIssueLink}
          merchantName={merchantName}
        />
      </CardContent>
    </Card>
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
  if (!stored) {
    return <p className="text-sm text-ink-muted">Save to send a link.</p>;
  }

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

  return (
    <div className="space-y-2 border-t border-line pt-4">
      {link ? (
        <>
          <Label htmlFor={linkFieldId}>Pick link</Label>
          <Input id={linkFieldId} className="min-h-11" readOnly value={link} onFocus={(e) => e.target.select()} />
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
        </>
      ) : stored.hasPickLink ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">Link sent</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending}>
                {pending ? "Making link…" : "Send new link"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send {stored.displayName} a new link?</AlertDialogTitle>
                <AlertDialogDescription>
                  The link you sent before will stop working.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={onIssue}>
                  Make new link
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onIssue}>
          {pending ? "Making link…" : "Create link"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
