import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/{game,client}/**/*.test.ts"],
    passWithNoTests: true,
  },
});
