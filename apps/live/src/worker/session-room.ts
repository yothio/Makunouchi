import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, PhaseKey, QuizPayload, ServerMessage } from "../shared/types";
import { safeEqualDigest, verifyPbkdf2 } from "./auth";
import { isGuestAtConnectionCap, isInboundMessageTooLarge } from "./connection-caps";
import { advance, createGameState, joinPlayer, phaseKey, presentResults, submitAnswer, type GameEvent, type Transition } from "./game/state";
import type { GameState } from "./game/types";
import { rankPlayers, type RankedPlayer } from "./game/ranking";
import { reserveHostLoginAttempt, type HostAttempts } from "./host-login-attempts";
import { parseClientMessage } from "./messages";
import type { HostCredentials } from "./payload";
import { isRole, ROLE_HEADER } from "./role";
import { guestView, hostView, screenView } from "./game/views";

type GuestAttachment = { role: "guest"; playerId: string | null };
type Attachment = { role: "host" } | { role: "screen" } | GuestAttachment;

const attachmentOf = (ws: WebSocket): Attachment | null => ws.deserializeAttachment() as Attachment | null;

export type RankingResult = { phaseKey: PhaseKey; final: boolean; players: RankedPlayer[] };
export type HostLoginResult = "ok" | "invalid" | "locked" | "missing";

export class SessionRoom extends DurableObject<Env> {
  private state: GameState | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat reply handled by the runtime without waking the DO from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.state = ctx.storage.kv.get<GameState>("state") ?? null;
  }

  async init(quiz: QuizPayload, host?: HostCredentials): Promise<"created" | "exists"> {
    if (this.state) return "exists";
    this.commit(createGameState(quiz));
    if (host) this.ctx.storage.kv.put("host", host);
    return "created";
  }

  /**
   * Verify host ID/password. Attempts are reserved (written) before PBKDF2 so concurrent requests
   * cannot slip past the lock while deriveBits is awaiting.
   */
  async hostLogin(loginId: string, password: string): Promise<HostLoginResult> {
    const host = this.ctx.storage.kv.get<HostCredentials>("host") ?? null;
    if (!this.state || !host) return "missing";

    const reserved = reserveHostLoginAttempt(
      this.ctx.storage.kv.get<HostAttempts>("hostAttempts") ?? null,
      Date.now(),
    );
    this.ctx.storage.kv.put("hostAttempts", reserved.attempts);
    if (reserved.outcome === "locked") return "locked";

    const passwordOk = await verifyPbkdf2(password, host.passwordHash);
    // Digest compare so loginId length does not short-circuit (safeEqual alone would).
    const loginIdOk = await safeEqualDigest(loginId, host.loginId);
    if (loginIdOk && passwordOk) {
      this.ctx.storage.kv.delete("hostAttempts");
      return "ok";
    }
    return "invalid";
  }

  async ranking(): Promise<RankingResult | null> {
    const s = this.state;
    if (!s) return null;
    const players = rankPlayers(s);
    return { phaseKey: phaseKey(s.phase), final: s.phase.type === "results", players };
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return new Response("not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const url = new URL(request.url);
    const role = request.headers.get(ROLE_HEADER);
    if (!isRole(role)) return new Response("bad role", { status: 400 });

    // Guests are capped; host/screen must still connect so the day can be run.
    // CLOSING/CLOSED sockets are excluded so a Wi-Fi blip's overlapping reconnects are less likely to 503.
    if (isGuestAtConnectionCap(role, this.ctx.getWebSockets())) {
      return new Response("too many connections", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    if (role === "host") {
      server.serializeAttachment({ role: "host" } satisfies Attachment);
      this.send(server, { type: "host_view", view: hostView(this.state) });
    } else if (role === "screen") {
      server.serializeAttachment({ role: "screen" } satisfies Attachment);
      this.send(server, { type: "screen_view", view: screenView(this.state) });
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
    if (!this.state) return;
    if (isInboundMessageTooLarge(raw)) {
      try {
        ws.close(1009, "message too large");
      } catch {
      }
      return;
    }
    if (typeof raw !== "string") return;
    const msg = parseClientMessage(raw);
    const att = attachmentOf(ws);
    if (!msg || !att) return;

    switch (msg.type) {
      case "advance":
        if (att.role === "host") this.onAdvance(msg);
        break;
      case "results_action":
        if (att.role === "host") this.onResultsAction(msg);
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

  private onResultsAction(msg: Extract<ClientMessage, { type: "results_action" }>): void {
    if (!this.state) return;
    this.apply(presentResults(this.state, msg.from, msg.action));
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
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "error");
    } catch {
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
    }
  }

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
   *   event               | hosts     | screens                         | guests
   *   --------------------|-----------|---------------------------------|---------------------------------
   *   phase_changed       | host_view | screen_view                     | guest_view to every joined guest
   *   projection_changed  | host_view | screen_view                     | -
   *   player_joined       | host_view | screen_view (only while lobby)  | guest_view to that player
   *   answer_recorded     | host_view | -                               | guest_view to that player
   *
   * A screen only needs the participant count while the lobby is shown, and never the answered count,
   * so joins after the start and answers do not touch it. Results projection never notifies guests.
   */
  private deliver(events: GameEvent[]): void {
    const s = this.state;
    if (!s || events.length === 0) return;
    let hosts = false;
    let screens = false;
    let allGuests = false;
    const guestIds = new Set<string>();
    for (const event of events) {
      switch (event.type) {
        case "phase_changed":
          hosts = true;
          screens = true;
          allGuests = true;
          break;
        case "projection_changed":
          hosts = true;
          screens = true;
          break;
        case "player_joined":
          hosts = true;
          if (s.phase.type === "lobby") screens = true;
          guestIds.add(event.playerId);
          break;
        case "answer_recorded":
          hosts = true;
          guestIds.add(event.playerId);
          break;
      }
    }
    const hostMsg: ServerMessage | null = hosts ? { type: "host_view", view: hostView(s) } : null;
    const screenMsg: ServerMessage | null = screens ? { type: "screen_view", view: screenView(s) } : null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachmentOf(ws);
      if (att?.role === "host") {
        if (hostMsg) this.send(ws, hostMsg);
        continue;
      }
      if (att?.role === "screen") {
        if (screenMsg) this.send(ws, screenMsg);
        continue;
      }
      if (att?.role !== "guest" || !att.playerId) continue;
      if (!allGuests && !guestIds.has(att.playerId)) continue;
      // One bad attachment must not abort delivery to everyone else after the commit.
      try {
        this.send(ws, { type: "guest_view", view: guestView(s, att.playerId) });
      } catch {
      }
    }
  }
}
