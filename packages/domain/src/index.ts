// Boilerplate — empty barrel. Example apps fill this with their own
// schemas and query functions, following the web-only convention.
// template --> export { function name } from file;

// Web-only domain logic: input validation schemas and database queries.
// Imported by apps/web only — ADR-0009.
export * from "./errors";
export * from "./parties";
export * from "./receipt";

