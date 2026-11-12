import { describe, expect, test } from "vitest";
import {
  guestPermanentErrorMessage,
  hostPermanentErrorMessage,
  permanentWsErrorFromCode,
  screenPermanentErrorMessage,
} from "./permanent-ws-error";
import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_UNAUTHORIZED } from "@shared/ws-close";

describe("permanentWsErrorFromCode", () => {
  test("4404 / 4401 だけを恒久エラーにする（1009 の巨大メッセージ切断は含めない）", () => {
    expect(permanentWsErrorFromCode(WS_CLOSE_SESSION_NOT_FOUND)).toBe("session_not_found");
    expect(permanentWsErrorFromCode(WS_CLOSE_UNAUTHORIZED)).toBe("unauthorized");
    expect(permanentWsErrorFromCode(1000)).toBeNull();
    expect(permanentWsErrorFromCode(1006)).toBeNull();
    expect(permanentWsErrorFromCode(1009)).toBeNull();
  });
});

describe("role-specific permanent error messages", () => {
  test("ゲストは QR、投影は開催回／トークン、幹事は開催回／URL", () => {
    expect(guestPermanentErrorMessage("session_not_found")).toBe("この QR コードは使えません");
    expect(guestPermanentErrorMessage("unauthorized")).toBe("URL が正しくありません");
    expect(screenPermanentErrorMessage("session_not_found")).toBe("この開催回は見つかりません");
    expect(screenPermanentErrorMessage("unauthorized")).toBe("URL が正しくありません（トークン不一致）");
    expect(hostPermanentErrorMessage("session_not_found")).toBe("この開催回は見つかりません");
    expect(hostPermanentErrorMessage("unauthorized")).toBe("URL が正しくありません");
  });
});
