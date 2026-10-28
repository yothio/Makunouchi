import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { ADMIN_API_SECRET: "test-secret" },
      },
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
  },
});
