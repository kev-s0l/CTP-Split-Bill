// Pure roster logic for the participants screen
// (docs/specs/receipts/participants-screen.md): the editor's row model, field
// checks shared with the API, and the PUT body.
import { normalizeEmail, normalizePhone } from "@project/domain/contact";

export const MAX_PARTICIPANTS = 50;

export type SavedParticipant = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  hasPickLink: boolean;
};

// What the page hands the editor, and what the editor keeps from a PUT response.
export type EditorReceipt = {
  id: string;
  revision: number;
  status: "DRAFT" | "FINALIZED";
  parseStatus: string;
  merchantName: string | null;
  participants: SavedParticipant[];
};

export type Row = {
  key: string;
  id?: string;
  displayName: string;
  phone: string;
  email: string;
};

export type FieldErrors = { phone?: string; email?: string };

export function toEditorReceipt(r: {
  id: string;
  revision: number;
  status: string;
  parseStatus: string;
  merchantName: string | null;
  participants: SavedParticipant[];
}): EditorReceipt {
  return {
    id: r.id,
    revision: r.revision,
    status: r.status === "FINALIZED" ? "FINALIZED" : "DRAFT",
    parseStatus: r.parseStatus,
    merchantName: r.merchantName,
    participants: r.participants.map(({ id, displayName, phone, email, hasPickLink }) => ({
      id, displayName, phone, email, hasPickLink,
    })),
  };
}

export function rowsFrom(participants: SavedParticipant[]): Row[] {
  return participants.map((p) => ({
    key: p.id,
    id: p.id,
    displayName: p.displayName,
    phone: p.phone ?? "",
    email: p.email ?? "",
  }));
}

export function isReadOnly(r: EditorReceipt): boolean {
  return r.status === "FINALIZED" || r.parseStatus === "PARSING";
}

export function placeholderName(index: number): string {
  return `Guest ${index + 1}`;
}

// Same rules and messages as the API (docs/specs/receipts/participants.md).
export function fieldErrors(row: Pick<Row, "phone" | "email">): FieldErrors {
  const errors: FieldErrors = {};
  if (row.phone.trim() !== "" && normalizePhone(row.phone) === null) {
    errors.phone = "Enter a valid phone number";
  }
  if (row.email.trim() !== "" && normalizeEmail(row.email) === null) {
    errors.email = "Enter a valid email address";
  }
  return errors;
}

// "+12125550101" → "(212) 555-0101"; other numbers and unparsed input as typed.
export function formatPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  const us = normalized?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : (normalized ?? phone.trim());
}

// The second line of a collapsed row: whichever contact details are filled in.
export function contactSummary(row: Pick<Row, "phone" | "email">): string {
  const parts = [row.phone.trim() && formatPhone(row.phone), row.email.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No phone or email";
}

export function hasErrors(errors: FieldErrors): boolean {
  return errors.phone !== undefined || errors.email !== undefined;
}

// True when the rows differ from what is saved: order, membership or any field.
export function isDirty(rows: Row[], saved: SavedParticipant[]): boolean {
  const savedRows = rowsFrom(saved);
  if (rows.length !== savedRows.length) return true;
  return rows.some((row, i) => {
    const s = savedRows[i]!;
    return row.id !== s.id || row.displayName !== s.displayName || row.phone !== s.phone || row.email !== s.email;
  });
}

// Save needs a change, no save in flight, and at least one person: the API
// rejects an empty roster, so the button never offers a save that must fail.
export function canSave(rows: Row[], dirty: boolean, saving: boolean): boolean {
  return dirty && !saving && rows.length > 0;
}

// The whole roster in display order. Empty strings are sent, not omitted:
// an empty phone or email clears it, and an empty name becomes "Guest N".
export function rosterRequest(rows: Row[], revision: number) {
  return {
    expectedRevision: revision,
    participants: rows.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      displayName: row.displayName,
      phone: row.phone,
      email: row.email,
    })),
  };
}
