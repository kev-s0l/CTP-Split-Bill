// The one error shape every route returns: { error: { code, message } }.
// Domain functions throw ApiError; route handlers catch and call toApiError.
// See docs/specs/web.md and docs/specs/api.md.

import type { ZodError } from "zod";
import { log } from "@project/log";

export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(code: ErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

// "name: String must contain at least 1 character(s)" — the first issue is enough
// for a client to act on.
export function invalidInput(error: ZodError): Response {
  const issue = error.issues[0];
  const path = issue?.path.join(".");
  const message = issue ? (path ? `${path}: ${issue.message}` : issue.message) : "Invalid input";
  return apiError("INVALID_INPUT", message, 400);
}

// Maps anything thrown inside a route to the error shape. Prisma errors are
// duck-typed by code so this package does not depend on Prisma's runtime classes.
export function toApiError(e: unknown): Response {
  if (e instanceof ApiError) return apiError(e.code, e.message, e.status);

  const prismaCode = (e as { code?: unknown } | null)?.code;
  if (prismaCode === "P2002") return apiError("CONFLICT", "That already exists", 409);
  if (prismaCode === "P2025") return apiError("NOT_FOUND", "Not found", 404);

  log.error({ err: e }, "unhandled error in route handler");
  return apiError("INTERNAL", "Something went wrong", 500);
}
