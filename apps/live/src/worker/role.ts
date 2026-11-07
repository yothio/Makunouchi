/** Internal Worker → Durable Object header carrying the already-authenticated socket role (a `Role`: "host" | "screen" | "guest"). */
export const ROLE_HEADER = "X-Makunouchi-Role";

/** Who a WebSocket belongs to: the operator (host), the projector (screen) or a participant (guest). */
export type Role = "host" | "screen" | "guest";

export const isRole = (value: unknown): value is Role => {
  return value === "host" || value === "screen" || value === "guest";
};
