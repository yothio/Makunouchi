/** Consecutive failed host-login attempts before a lockout window starts. */
export const HOST_LOGIN_MAX_FAILURES = 10;
/** Lock duration after the Nth failed attempt (ms). */
export const HOST_LOGIN_LOCK_MS = 60_000;

export type HostAttempts = {
  failures: number;
  /** Epoch ms when the lock ends; null when not locked. */
  lockedUntil: number | null;
};

export type ReserveResult =
  | { outcome: "locked"; attempts: HostAttempts }
  | { outcome: "reserved"; attempts: HostAttempts };

/**
 * Reserve one login attempt before PBKDF2 runs.
 * Clear expired locks first; refuse without verifying when already at the limit with a future unlock time;
 * otherwise increment and, on the 10th reservation, set lockedUntil (that 10th try still verifies).
 */
export const reserveHostLoginAttempt = (
  current: HostAttempts | null,
  now: number,
  maxFailures = HOST_LOGIN_MAX_FAILURES,
  lockMs = HOST_LOGIN_LOCK_MS,
): ReserveResult => {
  let failures = current?.failures ?? 0;
  let lockedUntil = current?.lockedUntil ?? null;
  if (lockedUntil !== null && lockedUntil <= now) {
    failures = 0;
    lockedUntil = null;
  }
  if (failures >= maxFailures && lockedUntil !== null && lockedUntil > now) {
    return { outcome: "locked", attempts: { failures, lockedUntil } };
  }
  failures += 1;
  if (failures >= maxFailures) lockedUntil = now + lockMs;
  return { outcome: "reserved", attempts: { failures, lockedUntil } };
};
