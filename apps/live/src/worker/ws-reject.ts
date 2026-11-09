/**
 * Accept the WebSocket upgrade, then close with an application code.
 * Browsers cannot read HTTP 401/404 on a failed WS handshake, so the client
 * only learns the permanent reason via the close code.
 * Used from the Worker (not the DO) so bad tokens never wake a Durable Object.
 */
export const rejectWebSocket = (code: number, reason: string): Response => {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
};
