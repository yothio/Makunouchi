/** Session was never created (or no longer exists). */
export const WS_CLOSE_SESSION_NOT_FOUND = 4404;
/** Host/screen token missing or wrong. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

export const isPermanentWsClose = (code: number): boolean => {
  return code === WS_CLOSE_SESSION_NOT_FOUND || code === WS_CLOSE_UNAUTHORIZED;
};
