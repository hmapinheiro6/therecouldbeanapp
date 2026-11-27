import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/search/**/*.test.ts", "tests/backend/**/*.test.{ts,mjs}"],
    testTimeout: 20000,
    hookTimeout: 60000,
    pool: "forks",
    maxWorkers: 2,
  },
});
