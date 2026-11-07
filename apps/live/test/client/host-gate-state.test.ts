import { describe, expect, test } from "vitest";
import {
  applyHostGateEvent,
  initialHostGateState,
  screenForHostGate,
  type HostGateState,
} from "../../src/client/host/host-gate-state";

describe("host-gate-state", () => {
  test("トークンが空なら HostLogin、あれば HostApp", () => {
    expect(screenForHostGate(initialHostGateState(""))).toBe("HostLogin");
    expect(screenForHostGate(initialHostGateState("tok"))).toBe("HostApp");
  });

  test("ログイン成功でトークンありへ遷移する", () => {
    const next = applyHostGateEvent(initialHostGateState(""), { type: "login_success", token: "abc" });
    expect(next).toEqual({ token: "abc" } satisfies HostGateState);
    expect(screenForHostGate(next)).toBe("HostApp");
  });

  test("破棄でトークンなしへ遷移する", () => {
    const next = applyHostGateEvent(initialHostGateState("abc"), { type: "discard_token" });
    expect(next).toEqual({ token: "" } satisfies HostGateState);
    expect(screenForHostGate(next)).toBe("HostLogin");
  });
});
