import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { ADMIN_API_SECRET: "test-secret-0123456789-abcdefghijklmnop" },
      },
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
  },
});
