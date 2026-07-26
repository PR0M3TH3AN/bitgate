import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/test/**/*.test.js",
      "tests/**/*.test.js",
    ],
    environment: "node",
    passWithNoTests: true,
  },
});
