import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // test/worker は miniflare で動かす統合テストなので vitest.workers.config.ts 側で実行する。
    // test/ の他の場所に単体テストを置いても拾われるようにして、置き場所の間違いで黙って実行されなくなるのを防ぐ。
    exclude: ["test/worker/**", "**/node_modules/**"],
    passWithNoTests: true,
  },
});
