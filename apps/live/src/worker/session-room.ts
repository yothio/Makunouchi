import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, QuizPayload, ServerMessage } from "../shared/types";
import { advance, createGameState, joinPlayer, phaseKey, submitAnswer, type GameEvent, type GameState, type Transition } from "./game/state";
import { isFinal, rankPlayers, type RankedPlayer } from "./game/ranking";
import { parseClientMessage } from "./messages";
import { guestView, hostView } from "./game/views";

type GuestAttachment = { role: "guest"; playerId: string | null };
type Attachment = { role: "host" } | GuestAttachment;

const attachmentOf = (ws: WebSocket): Attachment | null => ws.deserializeAttachment() as Attachment | null;

export type RankingResult = { phaseKey: string; final: boolean; players: RankedPlayer[] };

export class SessionRoom extends DurableObject<Env> {
  private state: GameState | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat reply handled by the runtime without waking the DO from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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
    if (!this.state || typeof raw !== "string") return;
    const msg = parseClientMessage(raw);
    const att = attachmentOf(ws);
    if (!msg || !att) return;

    switch (msg.type) {
      case "advance":
        if (att.role === "host") this.onAdvance(msg);
        break;
      case "join":
        if (att.role === "guest") this.onJoin(ws, att, msg);
        break;
      case "answer":
        if (att.role === "guest") this.onAnswer(att, msg);
        break;
    }
  }

  private onAdvance(msg: Extract<ClientMessage, { type: "advance" }>): void {
    if (!this.state) return;
    this.apply(advance(this.state, msg.from));
  }

  private onJoin(ws: WebSocket, att: GuestAttachment, msg: Extract<ClientMessage, { type: "join" }>): void {
    if (!this.state || att.playerId) return;
    const result = joinPlayer(this.state, msg.nickname, { id: crypto.randomUUID(), token: crypto.randomUUID() });
    if (!result.ok) {
      this.send(ws, { type: "join_error", reason: result.reason });
      return;
    }
    this.commit(result.state);
    ws.serializeAttachment({ role: "guest", playerId: result.player.id } satisfies Attachment);
    // `joined` (with the token) must precede the joiner's guest_view.
    this.send(ws, { type: "joined", playerToken: result.player.token });
    this.deliver(result.events);
  }

  private onAnswer(att: GuestAttachment, msg: Extract<ClientMessage, { type: "answer" }>): void {
    if (!this.state || !att.playerId) return;
    this.apply(submitAnswer(this.state, att.playerId, msg.questionIndex, msg.choice));
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "error");
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

  /** Commit a successful transition and deliver its events; returns false when rejected. */
  private apply(result: Transition<string>): boolean {
    if (!result.ok) return false;
    this.commit(result.state);
    this.deliver(result.events);
    return true;
  }

  /**
   * Single place deciding who is told what. Targets are collected first so each
   * socket receives at most one message per call.
   *
   *   event            | hosts     | guests
   *   -----------------|-----------|---------------------------
   *   phase_changed    | host_view | guest_view to every joined guest
   *   player_joined    | host_view | guest_view to that player
   *   answer_recorded  | host_view | guest_view to that player
   */
  private deliver(events: GameEvent[]): void {
    const s = this.state;
    if (!s || events.length === 0) return;
    let hosts = false;
    let allGuests = false;
    const guestIds = new Set<string>();
    for (const event of events) {
      switch (event.type) {
        case "phase_changed":
          hosts = true;
          allGuests = true;
          break;
        case "player_joined":
        case "answer_recorded":
          hosts = true;
          guestIds.add(event.playerId);
          break;
      }
    }
    const hostMsg: ServerMessage | null = hosts ? { type: "host_view", view: hostView(s) } : null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachmentOf(ws);
      if (att?.role === "host") {
        if (hostMsg) this.send(ws, hostMsg);
        continue;
      }
      if (att?.role !== "guest" || !att.playerId) continue;
      if (!allGuests && !guestIds.has(att.playerId)) continue;
      // One bad attachment must not abort delivery to everyone else after the commit.
      try {
        this.send(ws, { type: "guest_view", view: guestView(s, att.playerId) });
      } catch {
        // skip this socket
      }
    }
  }
}
