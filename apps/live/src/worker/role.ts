export const ROLE_HEADER = "X-Makunouchi-Role";

/** host=幹事操作, screen=投影, guest=参加者 */
export type Role = "host" | "screen" | "guest";

export const isRole = (value: unknown): value is Role => {
  return value === "host" || value === "screen" || value === "guest";
};
