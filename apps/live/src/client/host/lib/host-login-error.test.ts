import { describe, expect, test } from "vitest";
import { classifyHostLoginError } from "./host-login-error";

describe("host-login-error", () => {
  test("401/404/429/ネットワーク失敗を分類する", () => {
    expect(classifyHostLoginError({ kind: "http", status: 401 })).toBe("invalid_credentials");
    expect(classifyHostLoginError({ kind: "http", status: 404 })).toBe("unsupported");
    expect(classifyHostLoginError({ kind: "http", status: 429 })).toBe("locked");
    expect(classifyHostLoginError({ kind: "network" })).toBe("network");
  });

  test("想定外のステータスは network に寄せる", () => {
    expect(classifyHostLoginError({ kind: "http", status: 500 })).toBe("network");
  });
});
