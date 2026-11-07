import { describe, expect, test } from "vitest";
import { buildSocketUrl } from "../../src/client/socket-url";

describe("buildSocketUrl", () => {
  test("uses the role in the path and the token in the query", () => {
    expect(buildSocketUrl({ protocol: "http:", host: "localhost:5173" }, "host", "s", "tk")).toBe("ws://localhost:5173/ws/s/host?token=tk");
    expect(buildSocketUrl({ protocol: "http:", host: "localhost:5173" }, "screen", "s", "tk")).toBe("ws://localhost:5173/ws/s/screen?token=tk");
  });
  test("https becomes wss", () => {
    expect(buildSocketUrl({ protocol: "https:", host: "x.dev" }, "screen", "s", "tk")).toBe("wss://x.dev/ws/s/screen?token=tk");
  });
  test("session id and token are encoded", () => {
    expect(buildSocketUrl({ protocol: "https:", host: "x.dev" }, "host", "s 1", "a/b")).toBe("wss://x.dev/ws/s%201/host?token=a%2Fb");
  });
});
