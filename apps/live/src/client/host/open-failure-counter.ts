/** Offer "ログインし直す" after this many connect attempts that never opened. */
export const OPEN_FAILURE_RELOGIN_THRESHOLD = 3;

export type OpenFailureCounter = {
  neverOpened: number;
};

export const initialOpenFailureCounter = (): OpenFailureCounter => ({ neverOpened: 0 });

export const recordNeverOpened = (state: OpenFailureCounter): OpenFailureCounter => ({
  neverOpened: state.neverOpened + 1,
});

/** An open success resets the counter; the token itself is never cleared automatically. */
export const recordOpened = (_state: OpenFailureCounter): OpenFailureCounter => ({ neverOpened: 0 });

export const shouldOfferRelogin = (state: OpenFailureCounter): boolean => {
  return state.neverOpened >= OPEN_FAILURE_RELOGIN_THRESHOLD;
};
