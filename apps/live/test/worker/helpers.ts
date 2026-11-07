import { env, exports } from "cloudflare:workers";
import { hostTokenFor, screenTokenFor } from "../../src/worker/auth";
import type { QuizPayload, ServerMessage } from "../../src/shared/types";

export const quiz: QuizPayload = {
  title: "Test Quiz",
  questions: Array.from({ length: 5 }, (_, i) => ({
    title: `Q${i}`,
    imageUrl: null,
    choices: ["a", "b", "c", "d"] as [string, string, string, string],
    correctIndex: 1 as const,
  })),
};

export const authHeaders = { Authorization: `Bearer ${env.ADMIN_API_SECRET}`, "Content-Type": "application/json" };

let counter = 0;
export const newSessionId = (): string => {
  return `session-${Date.now()}-${counter++}-${crypto.randomUUID()}`;
};

export const createSession = async (sessionId: string): Promise<Response> => {
  return exports.default.fetch(`https://x/api/sessions/${sessionId}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify(quiz),
  });
};

export type Client = {
  ws: WebSocket;
  messages: ServerMessage[];
  send(msg: unknown): void;
  next<T extends ServerMessage["type"]>(
    type: T,
    pred?: (m: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
};

export const connect = async (path: string): Promise<Client> => {
  const res = await exports.default.fetch(`https://x${path}`, { headers: { Upgrade: "websocket" } });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const ws = res.webSocket;
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
    waiters.splice(0).forEach((w) => w());
  });
  ws.accept();
  const consumed = new Set<ServerMessage>();
  return {
    ws,
    messages,
    send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    async next(type, pred) {
      const deadline = Date.now() + 3000;
      for (;;) {
        const found = messages.find(
          (m) => !consumed.has(m) && m.type === type && (!pred || pred(m as never)),
        );
        if (found) {
          consumed.add(found);
          return found as never;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timeout waiting for ${type}; got ${JSON.stringify(messages)}`);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
  };
};

export const connectHost = async (sessionId: string): Promise<Client> => {
  const token = await hostTokenFor(env.ADMIN_API_SECRET, sessionId);
  return connect(`/ws/${sessionId}/host?token=${token}`);
};

export const connectScreen = async (sessionId: string): Promise<Client> => {
  const token = await screenTokenFor(env.ADMIN_API_SECRET, sessionId);
  return connect(`/ws/${sessionId}/screen?token=${token}`);
};

export const connectGuest = (sessionId: string, playerToken?: string) =>
  connect(`/ws/${sessionId}/guest${playerToken ? `?playerToken=${playerToken}` : ""}`);

export const rankingOf = async (sessionId: string) => {
  const res = await exports.default.fetch(`https://x/api/sessions/${sessionId}/ranking`, {
    headers: authHeaders,
  });
  return { status: res.status, body: (await res.json()) as any };
};
