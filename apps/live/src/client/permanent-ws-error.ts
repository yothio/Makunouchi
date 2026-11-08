import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_UNAUTHORIZED } from "../shared/ws-close";

export type PermanentWsError = "session_not_found" | "unauthorized";

export const permanentWsErrorFromCode = (code: number): PermanentWsError | null => {
  if (code === WS_CLOSE_SESSION_NOT_FOUND) return "session_not_found";
  if (code === WS_CLOSE_UNAUTHORIZED) return "unauthorized";
  return null;
};

export const guestPermanentErrorMessage = (error: PermanentWsError): string => {
  switch (error) {
    case "session_not_found":
      return "この QR コードは使えません";
    case "unauthorized":
      return "URL が正しくありません";
  }
};

export const screenPermanentErrorMessage = (error: PermanentWsError): string => {
  switch (error) {
    case "session_not_found":
      return "この開催回は見つかりません";
    case "unauthorized":
      return "URL が正しくありません（トークン不一致）";
  }
};

export const hostPermanentErrorMessage = (error: PermanentWsError): string => {
  switch (error) {
    case "session_not_found":
      return "この開催回は見つかりません";
    case "unauthorized":
      return "URL が正しくありません";
  }
};
