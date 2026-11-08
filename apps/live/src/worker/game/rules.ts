/** Nickname length limits, counted in code points after NFKC, control-char strip, and trim. */
export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 20;

export const CHOICE_COUNT = 4;

/** Hard cap on joined players per session (load test and docs use 150). */
export const MAX_PLAYERS = 150;

/**
 * Concurrent WebSocket cap in a session room.
 * 150 guests + host + screen + reconnect overlap (old socket not yet closed).
 */
export const MAX_WEBSOCKETS = 170;

/** Drop inbound frames larger than this before JSON parse (UTF-8 byte length). */
export const MAX_MESSAGE_BYTES = 8 * 1024;
