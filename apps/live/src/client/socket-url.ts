export type SocketRole = "host" | "screen";

export const buildSocketUrl = (
  loc: { protocol: string; host: string },
  role: SocketRole,
  sessionId: string,
  token: string,
): string => {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws/${encodeURIComponent(sessionId)}/${role}?token=${encodeURIComponent(token)}`;
};
