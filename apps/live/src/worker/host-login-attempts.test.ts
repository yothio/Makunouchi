import { describe, expect, test } from "vitest";
import {
  HOST_LOGIN_LOCK_MS,
  HOST_LOGIN_MAX_FAILURES,
  reserveHostLoginAttempt,
} from "./host-login-attempts";

describe("reserveHostLoginAttempt", () => {
  test("ロック期限切れ後は回数を消してから予約し、いきなりロックしない", () => {
    const now = 10_000;
    const expired = {
      failures: HOST_LOGIN_MAX_FAILURES,
      lockedUntil: now - 1,
    };
    const first = reserveHostLoginAttempt(expired, now);
    expect(first.outcome).toBe("reserved");
    expect(first.attempts).toEqual({ failures: 1, lockedUntil: null });

    const second = reserveHostLoginAttempt(first.attempts, now);
    expect(second.outcome).toBe("reserved");
    expect(second.attempts.failures).toBe(2);
    expect(second.attempts.lockedUntil).toBeNull();
  });

  test("解除時刻が未来で失敗上限に達していれば locked（照合しない）", () => {
    const now = 5_000;
    const result = reserveHostLoginAttempt(
      { failures: HOST_LOGIN_MAX_FAILURES, lockedUntil: now + HOST_LOGIN_LOCK_MS },
      now,
    );
    expect(result.outcome).toBe("locked");
    expect(result.attempts.failures).toBe(HOST_LOGIN_MAX_FAILURES);
  });

  test("10 回目の予約で lockedUntil を立てる", () => {
    const now = 1_000;
    let state = null;
    for (let i = 0; i < HOST_LOGIN_MAX_FAILURES - 1; i++) {
      const step = reserveHostLoginAttempt(state, now);
      expect(step.outcome).toBe("reserved");
      state = step.attempts;
    }
    const tenth = reserveHostLoginAttempt(state, now);
    expect(tenth.outcome).toBe("reserved");
    expect(tenth.attempts.failures).toBe(HOST_LOGIN_MAX_FAILURES);
    expect(tenth.attempts.lockedUntil).toBe(now + HOST_LOGIN_LOCK_MS);
  });
});
