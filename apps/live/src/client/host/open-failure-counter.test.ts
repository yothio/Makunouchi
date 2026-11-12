import { describe, expect, test } from "vitest";
import {
  initialOpenFailureCounter,
  shouldOfferRelogin,
  recordNeverOpened,
  recordOpened,
} from "./open-failure-counter";

describe("open-failure-counter", () => {
  test("一度も open しない失敗が 3 回でログインし直すを出す", () => {
    let state = initialOpenFailureCounter();
    expect(shouldOfferRelogin(state)).toBe(false);
    state = recordNeverOpened(state);
    state = recordNeverOpened(state);
    expect(shouldOfferRelogin(state)).toBe(false);
    state = recordNeverOpened(state);
    expect(shouldOfferRelogin(state)).toBe(true);
  });

  test("open が一度でも成功したら数え直す（トークンは自動では消えない）", () => {
    let state = initialOpenFailureCounter();
    state = recordNeverOpened(state);
    state = recordNeverOpened(state);
    state = recordNeverOpened(state);
    expect(shouldOfferRelogin(state)).toBe(true);
    state = recordOpened(state);
    expect(shouldOfferRelogin(state)).toBe(false);
    state = recordNeverOpened(state);
    expect(shouldOfferRelogin(state)).toBe(false);
  });
});
