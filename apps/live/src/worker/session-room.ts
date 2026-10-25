import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, QuizPayload, ServerMessage } from "../shared/types";
import { advance, createGameState, joinPlayer, phaseKey, submitAnswer, type GameState } from "./game/state";
import { isFinal, rankPlayers, type RankedPlayer } from "./game/ranking";
import { guestView, hostView } from "./game/views";

type Attachment = { role: "host" } | { role: "guest"; playerId: string | null };

export type RankingResult = { phaseKey: string; final: boolean; players: RankedPlayer[] };

export class SessionRoom extends DurableObject<Env> {
  private state: GameState | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = ctx.storage.kv.get<GameState>("state") ?? null;
  }

  async init(quiz: QuizPayload): Promise<"created" | "exists"> {
    if (this.state) return "exists";
    this.commit(createGameState(quiz));
    return "created";
  }

  async ranking(): Promise<RankingResult | null> {
    const s = this.state;
    if (!s) return null;
    return { phaseKey: phaseKey(s.phase), final: isFinal(s), players: rankPlayers(s) };
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return new Response("not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const url = new URL(request.url);
    const role = url.pathname.endsWith("/host") ? "host" : "guest";

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    if (role === "host") {
      server.serializeAttachment({ role: "host" } satisfies Attachment);
      this.send(server, { type: "host_view", view: hostView(this.state) });
    } else {
      const token = url.searchParams.get("playerToken");
      const player = token ? this.state.players.find((p) => p.token === token) : undefined;
      server.serializeAttachment({ role: "guest", playerId: player?.id ?? null } satisfies Attachment);
      if (player) this.send(server, { type: "guest_view", view: guestView(this.state, player.id) });
      else this.send(server, { type: "need_join" });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const s = this.state;
    if (!s || typeof raw !== "string") return;
    const msg = parseMessage(raw);
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!msg || !att) return;

    if (att.role === "host") {
      if (msg.type !== "advance") return;
      const next = advance(s, msg.from);
      if (next === s) return;
      this.commit(next);
      this.broadcastAll();
      return;
    }

    if (msg.type === "join") {
      if (att.playerId) return;
      const result = joinPlayer(s, msg.nickname, { id: crypto.randomUUID(), token: crypto.randomUUID() });
      if (!result.ok) {
        this.send(ws, { type: "join_error", reason: result.reason });
        return;
      }
      this.commit(result.state);
      ws.serializeAttachment({ role: "guest", playerId: result.player.id } satisfies Attachment);
      this.send(ws, { type: "joined", playerToken: result.player.token });
      this.send(ws, { type: "guest_view", view: guestView(result.state, result.player.id) });
      this.broadcastHosts();
      return;
    }

    if (msg.type === "answer") {
      if (!att.playerId) return;
      const next = submitAnswer(s, att.playerId, msg.questionIndex, msg.choice);
      if (next === s) return;
      this.commit(next);
      this.broadcastGuest(att.playerId);
      this.broadcastHosts();
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  private commit(next: GameState): void {
    this.state = next;
    this.ctx.storage.kv.put("state", next);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket gone
    }
  }

  private broadcastHosts(): void {
    const s = this.state;
    if (!s) return;
    const msg: ServerMessage = { type: "host_view", view: hostView(s) };
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.role === "host") this.send(ws, msg);
    }
  }

  private broadcastGuest(onlyPlayerId?: string): void {
    const s = this.state;
    if (!s) return;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.role !== "guest" || !att.playerId) continue;
      if (onlyPlayerId && att.playerId !== onlyPlayerId) continue;
      this.send(ws, { type: "guest_view", view: guestView(s, att.playerId) });
    }
  }

  private broadcastAll(): void {
    this.broadcastHosts();
    this.broadcastGuest();
  }
}

function parseMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === "join" && typeof m.nickname === "string") return { type: "join", nickname: m.nickname };
  if (m.type === "answer" && typeof m.questionIndex === "number" && typeof m.choice === "number")
    return { type: "answer", questionIndex: m.questionIndex, choice: m.choice };
  if (m.type === "advance" && typeof m.from === "string") return { type: "advance", from: m.from };
  return null;
}
