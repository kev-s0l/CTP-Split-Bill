import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Routes @project/db to an in-memory PGlite with migrations applied — ADR-0005.
    env: { PGLITE_DATA_DIR: "memory://" },
  },
});
