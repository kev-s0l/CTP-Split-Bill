// Participants screen (docs/specs/receipts/participants-screen.md): the share
// builders, roster logic, and static renders of its states. No DOM, no database.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mailtoHref, pickLinkMessage, smsHref } from "../app/lib/pick-link-share";
import { ParticipantRow, ParticipantsEditor, PickLink } from "../app/receipts/[id]/participants/ParticipantsEditor";
import {
  type EditorReceipt,
  type SavedParticipant,
  contactSummary,
  fieldErrors,
  formatPhone,
  isDirty,
  isReadOnly,
  rosterRequest,
  rowsFrom,
} from "../app/receipts/[id]/participants/roster";

const maya: SavedParticipant = { id: "p1", displayName: "Maya", phone: "+15552013344", email: null, hasPickLink: false };
const sam: SavedParticipant = { id: "p2", displayName: "Sam", phone: null, email: "sam@example.com", hasPickLink: true };

function receipt(overrides: Partial<EditorReceipt> = {}): EditorReceipt {
  return {
    id: "r1",
    revision: 3,
    status: "DRAFT",
    parseStatus: "SUCCEEDED",
    merchantName: "Joe's Pizza",
    participants: [maya, sam],
    ...overrides,
  };
}

describe("pick-link message and hrefs", () => {
  it("names the merchant when there is one, and falls back when blank", () => {
    expect(pickLinkMessage("http://x/p/t", "Joe's Pizza")).toBe("Pick what you had at Joe's Pizza: http://x/p/t");
    expect(pickLinkMessage("http://x/p/t", null)).toBe("Tap the items you had: http://x/p/t");
    expect(pickLinkMessage("http://x/p/t", "   ")).toBe("Tap the items you had: http://x/p/t");
  });

  it("builds an sms: href with the E.164 phone kept and the body encoded", () => {
    expect(smsHref("+15552013344", "Pick what you had at Joe's: http://x/p/a?b&c")).toBe(
      "sms:+15552013344?body=Pick%20what%20you%20had%20at%20Joe's%3A%20http%3A%2F%2Fx%2Fp%2Fa%3Fb%26c",
    );
  });

  it("builds a mailto: href with subject and body, and cannot be split by the address", () => {
    expect(mailtoHref("maya@example.com", "hi & bye")).toBe(
      "mailto:maya@example.com?subject=Split%20Bill&body=hi%20%26%20bye",
    );
    expect(mailtoHref("a?cc=x@example.com", "m")).toBe("mailto:a%3Fcc%3Dx@example.com?subject=Split%20Bill&body=m");
  });
});

describe("roster logic", () => {
  it("checks phone and email with the API's rules and messages", () => {
    expect(fieldErrors({ phone: "12", email: "maya@" })).toEqual({
      phone: "Enter a valid phone number",
      email: "Enter a valid email address",
    });
    expect(fieldErrors({ phone: "(555) 201-3344", email: " Maya@Example.com " })).toEqual({});
    expect(fieldErrors({ phone: "", email: "  " })).toEqual({});
  });

  it("maps rows to the PUT body in order, keeping ids and sending blanks so they clear", () => {
    const rows = [
      { key: "new-0", displayName: "", phone: "", email: "" },
      ...rowsFrom([maya]).map((r) => ({ ...r, phone: "" })),
    ];
    expect(rosterRequest(rows, 3)).toEqual({
      expectedRevision: 3,
      participants: [
        { displayName: "", phone: "", email: "" },
        { id: "p1", displayName: "Maya", phone: "", email: "" },
      ],
    });
  });

  it("is dirty after an edit, an add, a removal or a reorder, and clean otherwise", () => {
    const saved = [maya, sam];
    const rows = rowsFrom(saved);
    expect(isDirty(rows, saved)).toBe(false);
    expect(isDirty([{ ...rows[0]!, email: "m@example.com" }, rows[1]!], saved)).toBe(true);
    expect(isDirty([...rows, { key: "new-0", displayName: "", phone: "", email: "" }], saved)).toBe(true);
    expect(isDirty([rows[0]!], saved)).toBe(true);
    expect(isDirty([rows[1]!, rows[0]!], saved)).toBe(true);
  });

  it("formats US phones for the row summary and lists whichever contacts exist", () => {
    expect(formatPhone("+12125550101")).toBe("(212) 555-0101");
    expect(formatPhone("212 555 0101")).toBe("(212) 555-0101");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
    expect(contactSummary({ phone: "+12125550101", email: "a@example.com" })).toBe("(212) 555-0101 · a@example.com");
    expect(contactSummary({ phone: "", email: "a@example.com" })).toBe("a@example.com");
    expect(contactSummary({ phone: " ", email: "" })).toBe("No phone or email");
  });

  it("is read-only when finalized or parsing", () => {
    expect(isReadOnly(receipt())).toBe(false);
    expect(isReadOnly(receipt({ status: "FINALIZED" }))).toBe(true);
    expect(isReadOnly(receipt({ parseStatus: "PARSING" }))).toBe(true);
  });
});

describe("participants screen renders", () => {
  const render = (r: EditorReceipt) => renderToStaticMarkup(h(ParticipantsEditor, { initial: r }));
  const noop = () => {};
  const rowProps = {
    index: 0,
    readOnly: false,
    expanded: false,
    onToggle: noop,
    errors: {},
    onChange: noop,
    onBlur: noop,
    onRemove: noop,
    link: undefined,
    linkError: undefined,
    linkPending: false,
    onIssueLink: noop,
    merchantName: null,
  };

  it("shows the empty state with an Add person button for an empty roster", () => {
    const html = render(receipt({ participants: [] }));
    expect(html).toContain("No one&#x27;s on this receipt yet");
    expect(html).toMatch(/<button[^>]*>Add person<\/button>/);
  });

  it("renders one compact row per person, collapsed, with a disabled Save while nothing changed", () => {
    const html = render(receipt());
    expect(html).toContain(">Maya<");
    expect(html).toContain("(555) 201-3344");
    expect(html).toContain("sam@example.com");
    expect(html).not.toContain("<input");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/>No link</);
    expect(html).toMatch(/>Link sent</);
    expect(html).toMatch(/>Create link</);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
  });

  it("shows the name, phone and email fields when a row is expanded", () => {
    const [row] = rowsFrom([maya]);
    const html = renderToStaticMarkup(h(ParticipantRow, { ...rowProps, row: row!, stored: maya, expanded: true }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/<input[^>]*id="p1-name"[^>]*value="Maya"/);
    expect(html).toMatch(/<input[^>]*id="p1-phone"/);
    expect(html).toMatch(/<input[^>]*id="p1-email"/);
  });

  it("flags a row with a bad phone in its summary, so the error shows while collapsed", () => {
    const row = { key: "new-0", displayName: "", phone: "12", email: "" };
    const html = renderToStaticMarkup(
      h(ParticipantRow, { ...rowProps, row, stored: undefined, errors: { phone: "Enter a valid phone number" } }),
    );
    expect(html).toContain("Fix the phone or email");
    expect(html).toContain(">Guest 1<");
    expect(html).toMatch(/>Not saved</);
  });

  it("is read-only when finalized: no editing, no Save, but link actions stay", () => {
    const html = render(receipt({ status: "FINALIZED" }));
    expect(html).toContain("This receipt is finalized");
    expect(html).not.toMatch(/>Save</);
    expect(html).not.toMatch(/Add person/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Maya/);
    expect(html).toMatch(/>Create link</);
  });

  it("offers nothing to share for an unsaved row", () => {
    const html = renderToStaticMarkup(
      h(PickLink, { rowKey: "new-0", stored: undefined, link: undefined, error: undefined, pending: false, onIssue: noop, merchantName: null }),
    );
    expect(html).toBe("");
  });

  it("shows Text only with a phone, Email only with an email, and always Copy link", () => {
    const shown = (stored: SavedParticipant) =>
      renderToStaticMarkup(
        h(PickLink, { rowKey: stored.id, stored, link: "http://x/p/tok", error: undefined, pending: false, onIssue: noop, merchantName: "Joe's Pizza" }),
      );
    const withPhone = shown(maya);
    expect(withPhone).toContain('value="http://x/p/tok"');
    expect(withPhone).toContain('href="sms:+15552013344?body=Pick%20what%20you%20had%20at%20Joe');
    expect(withPhone).not.toContain("mailto:");
    expect(withPhone).toMatch(/>Copy link</);
    expect(withPhone).toContain("Shown once");

    const withEmail = shown({ ...sam, phone: null });
    expect(withEmail).toContain('href="mailto:sam@example.com?subject=Split%20Bill');
    expect(withEmail).not.toContain("sms:");
  });
});
