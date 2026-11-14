// Pure upload-form logic (docs/specs/receipts/upload-screen.md, "Upload"):
// the form's states, the type check, and what each upload response means.

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

export const MESSAGES = {
  wrongType: "Choose a JPEG, PNG or WebP photo",
  tooLarge: "This photo is too large. Try a screenshot of it.",
  storage: "Couldn't save the photo. Try again in a moment.",
  network: "Couldn't reach the server. Check your connection and try again.",
  generic: "Something went wrong. Try again in a moment.",
} as const;

export type UploadState =
  | { phase: "choose"; error: string | null }
  | { phase: "preview" | "preparing" | "uploading"; file: File; error: string | null };

export type UploadAction =
  | { type: "chose"; file: File }
  | { type: "chooseAgain" }
  | { type: "preparing" }
  | { type: "uploading" }
  | { type: "failed"; error: string };

export const initialUploadState: UploadState = { phase: "choose", error: null };

// Choosing a photo only shows it; nothing is sent until the organizer
// confirms with Scan this receipt.
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "chose":
      if (!(ACCEPTED_TYPES as readonly string[]).includes(action.file.type)) {
        return { phase: "choose", error: MESSAGES.wrongType };
      }
      return { phase: "preview", file: action.file, error: null };
    case "chooseAgain":
      return initialUploadState;
    case "preparing":
    case "uploading":
      return state.phase === "choose" ? state : { phase: action.type, file: state.file, error: null };
    case "failed":
      return state.phase === "choose" ? { ...state, error: action.error } : { phase: "preview", file: state.file, error: action.error };
  }
}

export type UploadOutcome =
  | { kind: "scan"; receiptId: string }
  | { kind: "login" }
  | { kind: "error"; message: string };

// Maps a POST /api/receipts response (receipts/upload.md) to what the form does.
export function uploadOutcome(status: number, body: unknown): UploadOutcome {
  const data = body as { id?: unknown; error?: { message?: unknown } } | null;
  if (status === 201 && typeof data?.id === "string") return { kind: "scan", receiptId: data.id };
  if (status === 401) return { kind: "login" };
  if (status === 400 && typeof data?.error?.message === "string") return { kind: "error", message: data.error.message };
  if (status === 503) return { kind: "error", message: MESSAGES.storage };
  return { kind: "error", message: MESSAGES.generic };
}
