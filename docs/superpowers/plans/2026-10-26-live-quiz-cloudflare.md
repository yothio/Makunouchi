# 当日進行（Cloudflare 側）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 開催回あたり最大 120 人のゲストと幹事の投影画面を WebSocket でつなぎ、受付 → 出題 → 締切 → 正解発表 → 最終発表（4 位〜XX 位の一覧と、3・2・1 位のめくり）を止まらずに進行できる `apps/live` を作る。

**Architecture:** 状態遷移・採点・順位・各画面に送る内容は、副作用のない純粋関数（`src/worker/game/`）にまとめる。Durable Object `SessionRoom` は開催回ごとに 1 つ作る。状態を JSON 1 件として SQLite-backed storage に保存し、WebSocket Hibernation API で接続を持つ。Hono の Worker は、Rails 向け API、WebSocket の入口、React SPA（ゲスト画面・投影画面）を配信する。

**Tech Stack:** pnpm workspace, TypeScript, Cloudflare Workers + Durable Objects (SQLite-backed), Hono, zod, React 19 + Vite + `@cloudflare/vite-plugin`, `qrcode.react`, Vitest + `@cloudflare/vitest-pool-workers`

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`

## Global Constraints

- 1 開催回の参加者は最大 120 人程度。負荷試験は余裕を見て 150 接続で行う。問題数は 5〜15 問。
- 問題は 4 択（選択肢 4 つ、正解 1 つ）のみ。回答の速さは点数に入れない。
- 点数は、正解した問題の配点の合計。配点は問題ごとに持つ（Rails 側で初期値を入れたうえで送ってくる）。
- 同点は同じ順位にする（競技方式。90, 90, 80 なら 1, 1, 3 位）。
- 最終発表は「4 位〜topN 位の一覧 → 3 位を伏せる → めくる → 2 位を伏せる → めくる → 1 位を伏せる → めくる」の順。topN は開催回ごとの値。
- ゲストに自分の順位を見せるのは、1 位をめくった後。
- 締め切るまでは回答を選び直せる。スタート後も参加でき、最終発表が始まったら参加を締め切る。
- 同じ開催回の中で同じニックネームは使えない。ニックネームは NFKC 正規化と前後の空白除去をした後で比較し、1〜20 文字とする。
- 別のブラウザから入り直した人は復帰させない。端末に保存した `playerToken` だけを本人確認に使う。
- 開催回 ID は Rails が発行する推測困難な文字列（UUID）。ゲスト URL は `/s/:sessionId`、投影画面 URL は `/host/:sessionId?token=<hostToken>` とする。
- `hostToken` = HMAC-SHA256(`ADMIN_API_SECRET`, sessionId) の hex 文字列。Rails も同じ計算をする。
- Rails からの API 呼び出しは `Authorization: Bearer <ADMIN_API_SECRET>` で認証する。
- 問題の説明（幹事のメモ）は live 側に送らない。
- 依存パッケージはインストール時点の最新安定版を使う。`compatibility_date` は `2026-10-01` とする。

## Review Focus

1. **正解の漏えい**: 締め切った後や正解発表の前に、ゲストの WebSocket に `correctIndex` や他人の回答が含まれていると、開発者ツールで覗くゲストに答えが分かってしまう。→ Task 4 の `guestView` のテストで確認する。
2. **前の問題への遅れた回答**: 幹事が次へ進めた直後に、前の問題への回答が届くことがある。これは無視されるべきで、新しい問題の回答として数えてはいけない。→ Task 2 で確認する。
3. **進行ボタンの二度押し、または 2 つのタブからの同時操作**: 1 回押しただけなのに 2 段階進んで、正解発表などを飛ばしてはいけない。→ 進める操作に「いまの段階のキー」を付け、一致したときだけ進める。Task 2 と Task 5 で確認する。
4. **Durable Object の再起動や休止の後の復帰**: メモリ上の状態が消えても、保存済みの状態から同じ段階、同じ点数で再開できるべき。→ Task 5 で確認する。
5. **見つからない playerToken での再接続**（リハーサル回の token、壊れた token など）: エラーで固まらずに、参加フォームへ戻すべき。→ Task 5（サーバー側）と Task 6（クライアント側）で確認する。

---

## ファイル構成

```
package.json                     # pnpm workspace ルート（scripts: test, typecheck）
pnpm-workspace.yaml              # packages: ["apps/*"]
apps/live/
  package.json
  wrangler.jsonc                 # DO binding SESSION_ROOM, assets, migrations(new_sqlite_classes)
  vite.config.ts                 # react() + cloudflare()
  vitest.config.ts               # 純粋ロジック（node 環境）
  vitest.workers.config.ts       # Worker/DO の結合テスト（pool-workers）
  index.html
  src/shared/
    types.ts                     # QuizPayload, Phase, HostView, GuestView, ClientMessage, ServerMessage
  src/worker/
    index.ts                     # Hono app + export SessionRoom
    auth.ts                      # hostToken / Bearer 検証
    payload.ts                   # zod スキーマ quizPayloadSchema
    session-room.ts              # Durable Object
    game/
      state.ts                   # GameState と純粋な状態遷移
      ranking.ts                 # 順位計算・発表枠
      views.ts                   # hostView / guestView
  src/client/
    main.tsx                     # パスでゲスト画面と投影画面を出し分け
    use-live-socket.ts           # 再接続つき WebSocket フック
    guest/GuestApp.tsx (+ 画面部品)
    host/HostApp.tsx (+ 画面部品)
  test/
    game/*.test.ts               # node 環境
    worker/*.test.ts             # pool-workers
  scripts/loadtest.ts            # 150 接続の負荷試験
```

---

### Task 1: モノレポとプロジェクトの雛形

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `apps/live/package.json`, `apps/live/wrangler.jsonc`, `apps/live/vite.config.ts`, `apps/live/vitest.config.ts`, `apps/live/vitest.workers.config.ts`, `apps/live/tsconfig.json`, `apps/live/index.html`, `apps/live/src/worker/index.ts`, `apps/live/src/client/main.tsx`
- Test: `apps/live/test/worker/health.test.ts`

**Interfaces:**
- Produces:
  - `pnpm --filter live test`（両方の vitest 設定を実行する）、`pnpm --filter live dev`、`pnpm --filter live typecheck`
  - Worker 環境の型 `Env { SESSION_ROOM: DurableObjectNamespace<SessionRoom>; ADMIN_API_SECRET: string; ASSETS: Fetcher }`
  - `wrangler.jsonc` の設定:
    - `assets.not_found_handling: "single-page-application"`
    - `assets.run_worker_first: ["/api/*", "/ws/*"]`
    - DO class `SessionRoom` を `new_sqlite_classes` で登録する（この時点では空実装で可）

- [ ] **Step 1: 失敗するテストを書く** — `SELF.fetch("https://x/api/health")` の status が 200 で、body が `{ ok: true }` であることを確かめる。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm --filter live test`。Expected: FAIL（404 または設定がない）。
- [ ] **Step 3: 雛形を作る** — Hono に `GET /api/health` を追加し、`main.tsx` は「Makunouchi」とだけ表示する。テスト用のシークレットは `vitest.workers.config.ts` の miniflare bindings に `ADMIN_API_SECRET: "test-secret"` として入れる。ルートの `.gitignore` に `node_modules/`、`.wrangler/`、`dist/`、`.dev.vars` を追加する。
- [ ] **Step 4: 実行して成功を確認** — `pnpm --filter live test && pnpm --filter live typecheck`。Expected: PASS。
- [ ] **Step 5: Commit** — `chore(live): scaffold Cloudflare app in pnpm workspace`

---

### Task 2: 共有の型と、ゲームの状態遷移（純粋関数）

**Files:**
- Create: `apps/live/src/shared/types.ts`, `apps/live/src/worker/payload.ts`, `apps/live/src/worker/game/state.ts`
- Test: `apps/live/test/game/payload.test.ts`, `apps/live/test/game/state.test.ts`

**Interfaces:**
- Produces (`shared/types.ts`):
  ```ts
  type Choice = 0 | 1 | 2 | 3;
  type QuizQuestion = { title: string; imageUrl: string | null; choices: [string, string, string, string]; correctIndex: Choice; points: number };
  type QuizPayload = { title: string; topN: number; questions: QuizQuestion[] };
  type ResultsStage = { kind: "list" } | { kind: "podium"; rank: 1 | 2 | 3; revealed: boolean };
  type Phase =
    | { type: "lobby" }
    | { type: "question"; index: number; status: "open" | "closed" | "revealed" }
    | { type: "results"; stage: ResultsStage };
  ```
- Produces (`payload.ts`): `quizPayloadSchema`（zod）。各項目の条件は次のとおり。
  - `title`: 1〜100 文字
  - `topN`: 整数で 4〜100
  - `questions`: 5〜15 件
  - 問題の `title`: 1〜200 文字
  - `choices`: 1〜50 文字の文字列を 4 つ
  - `correctIndex`: 0〜3
  - `points`: 整数で 1〜1000
  - `imageUrl`: https の URL または null
- Produces (`game/state.ts`):
  ```ts
  type Player = { id: string; token: string; nickname: string; answers: Record<number, Choice> };
  type GameState = { quiz: QuizPayload; phase: Phase; players: Player[] };
  function createGameState(quiz: QuizPayload): GameState;
  function phaseKey(phase: Phase): string;              // 例: "lobby", "q:2:open", "r:list", "r:3:hidden"
  function joinPlayer(s: GameState, nickname: string, ids: { id: string; token: string }):
    { ok: true; state: GameState; player: Player } | { ok: false; reason: "nickname_taken" | "nickname_invalid" | "closed" };
  function submitAnswer(s: GameState, playerId: string, questionIndex: number, choice: number): GameState; // 受け付けられない回答なら s をそのまま返す
  function advance(s: GameState, fromKey: string): GameState;  // fromKey が phaseKey(s.phase) と違えば s をそのまま返す
  function scoreOf(s: GameState, player: Player): number;      // 正解発表済み（revealed、またはそれより後）の問題だけを採点する
  ```
  `advance` から呼ぶ発表枠の判定には Task 3 の `podiumHasPlayers` を使う。そのため、`advance` の results 部分のテストは Task 3 で書く。このタスクでは問題の段階までを扱う。

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  // payload.test.ts
  test("4 択でない問題は拒否", () => expect(quizPayloadSchema.safeParse(withChoices(3)).success).toBe(false));
  test("問題数 4 と 16 は拒否、5 と 15 は通る", ...);
  test("topN 3 は拒否", ...);

  // state.test.ts
  test("lobby → q:0:open → q:0:closed → q:0:revealed → q:1:open", () => { /* advance を phaseKey 付きで 4 回 */ });
  test("古い fromKey での advance は何もしない（二度押し）", () => {
    const s1 = advance(s0, "lobby");          // q:0:open
    expect(advance(s1, "lobby")).toBe(s1);
  });
  test("締切まで回答を上書きでき、締切後は変わらない", ...);
  test("前の問題 index への回答は無視", () => { /* q:1:open で questionIndex 0 を送っても answers[0] が変わらない */ });
  test("choice 4 や -1 は無視", ...);
  test("ニックネームは NFKC・trim 後に重複判定（'ＴＡＲＯ ' と 'TARO' は重複）", ...);
  test("空白だけ・21 文字は nickname_invalid", ...);
  test("スタート後の参加は可、参加前の問題は 0 点", ...);
  test("results 中の参加は closed", ...);
  test("scoreOf は closed の問題を数えず、revealed になって初めて加点（配点 10 と 30）", ...);
  ```
- [ ] **Step 2: 実行して失敗を確認** — `pnpm --filter live exec vitest run -c vitest.config.ts`。Expected: FAIL（モジュールがない）。
- [ ] **Step 3: 実装する** — すべてイミュータブルに書き、新しい state を返す。`submitAnswer` は、`phase` が `question` かつ `status === "open"` で、`index === questionIndex` のときだけ受け付ける。最後の問題が revealed の状態から `advance` すると、`{ type: "results", stage: { kind: "list" } }` に移る。
- [ ] **Step 4: 実行して成功を確認** — 同じコマンドを実行する。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): quiz payload schema and game state transitions`

---

### Task 3: 順位と最終発表の枠

**Files:**
- Create: `apps/live/src/worker/game/ranking.ts`
- Modify: `apps/live/src/worker/game/state.ts`（`advance` の results 部分）
- Test: `apps/live/test/game/ranking.test.ts`, `apps/live/test/game/state.test.ts`

**Interfaces:**
- Consumes: `GameState`, `scoreOf`
- Produces:
  ```ts
  type RankedPlayer = { playerId: string; nickname: string; score: number; rank: number };
  function rankPlayers(s: GameState): RankedPlayer[];          // 点数の降順。同点は参加順
  function listEntries(s: GameState): RankedPlayer[];          // 4 <= rank <= topN の人
  function podiumPlayers(s: GameState, rank: 1 | 2 | 3): RankedPlayer[];
  function podiumHasPlayers(s: GameState, rank: 1 | 2 | 3): boolean;
  function isFinal(s: GameState): boolean;                     // 1 位をめくった後、または参加者が 0 人で list に進んだ後
  ```

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  test("90,90,80,70 → rank 1,1,3,4", ...);
  test("listEntries は 4 位〜topN 位。topN=5 で rank 6 の人は含まない", ...);
  test("同点で rank が 1 位から 4 位に飛ぶ（90,90,90,70）と、2 位・3 位の枠は空", () => {
    expect(podiumHasPlayers(s, 3)).toBe(false); expect(podiumHasPlayers(s, 2)).toBe(false);
  });
  // state.test.ts に追加
  test("results: list → 3 位(伏せ) → 3 位(表) → 2 位(伏せ) → 2 位(表) → 1 位(伏せ) → 1 位(表)", ...);
  test("空の発表枠は飛ばす（90,90,90,70 なら list → 1 位(伏せ)）", ...);
  test("1 位(表) からの advance は何もしない。isFinal は true", ...);
  test("参加者 0 人でも最後まで進められる（list で isFinal）", ...);
  ```
- [ ] **Step 2: 実行して失敗を確認** — `pnpm --filter live exec vitest run -c vitest.config.ts`。Expected: FAIL。
- [ ] **Step 3: 実装する** — rank は競技方式（自分より点数が高い人数 + 1）で求める。`advance` は、発表枠を 3 → 2 → 1 位の順に `podiumHasPlayers` が true の枠だけ進める。
- [ ] **Step 4: 実行して成功を確認** — Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): ranking and podium reveal stages`

---

### Task 4: 各画面に送る内容（ビュー）

**Files:**
- Create: `apps/live/src/worker/game/views.ts`
- Modify: `apps/live/src/shared/types.ts`（ビューとメッセージの型を追加）
- Test: `apps/live/test/game/views.test.ts`

**Interfaces:**
- Consumes: `GameState`, `rankPlayers`, `listEntries`, `podiumPlayers`, `isFinal`, `scoreOf`, `phaseKey`
- Produces (`shared/types.ts`):
  ```ts
  type PublicQuestion = { index: number; total: number; title: string; imageUrl: string | null; choices: [string, string, string, string] };
  type HostView = {
    title: string; phaseKey: string; playerCount: number;
    screen:
      | { kind: "lobby" }
      | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; answeredCount: number }
      | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; counts: [number, number, number, number]; isLast: boolean }
      | { kind: "list"; entries: { rank: number; nickname: string; score: number }[]; nextRank: 1 | 2 | 3 | null }
      | { kind: "podium"; rank: 1 | 2 | 3; revealed: boolean; players: { nickname: string; score: number }[]; nextRank: 1 | 2 | 3 | null }; // revealed=false なら players は []。nextRank は次に発表する空でない枠（なければ null）
  };
  type GuestView =
    | { kind: "lobby"; title: string; nickname: string }
    | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; myChoice: Choice | null }
    | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; myChoice: Choice | null; correct: boolean; score: number }
    | { kind: "results_pending"; nickname: string }
    | { kind: "final"; nickname: string; rank: number; score: number; playerCount: number };
  type ClientMessage =
    | { type: "join"; nickname: string }
    | { type: "answer"; questionIndex: number; choice: number }
    | { type: "advance"; from: string };
  type ServerMessage =
    | { type: "host_view"; view: HostView }
    | { type: "guest_view"; view: GuestView }
    | { type: "need_join" }
    | { type: "joined"; playerToken: string }
    | { type: "join_error"; reason: "nickname_taken" | "nickname_invalid" | "closed" };
  ```
- Produces (`views.ts`): `hostView(s: GameState): HostView`, `guestView(s: GameState, playerId: string): GuestView`

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  test("open・closed の段階では、guestView と hostView の JSON に correctIndex が含まれない", () => {
    expect(JSON.stringify(guestView(closed, p1))).not.toContain("correctIndex");
    expect(JSON.stringify(hostView(closed))).not.toContain("correctIndex");
  });
  test("guestView に他人のニックネームや回答が含まれない（final 以外）", ...);
  test("podium で revealed=false の hostView には players が空で、ニックネームが含まれない", ...);
  test("最終発表の途中（1 位を伏せている段階まで）は results_pending、1 位をめくった後は final で rank と score が入る", ...);
  test("reveal の counts は選択肢ごとの回答数、answeredCount は現在の問題に回答した人数", ...);
  test("reveal の isLast は最後の問題のとき true", ...);
  test("list の nextRank は空でない最初の枠（90,90,90,70 なら 1）、1 位(表) の nextRank は null", ...);
  ```
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装する** — `QuizQuestion` から `PublicQuestion` を作るときは、`correctIndex` と `points` を落とす。`correctIndex` は reveal 用の型にだけ入れる。
- [ ] **Step 4: 実行して成功を確認** — Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): host and guest views without answer leakage`

---

### Task 5: Durable Object と Worker の API

**Files:**
- Create: `apps/live/src/worker/session-room.ts`, `apps/live/src/worker/auth.ts`
- Modify: `apps/live/src/worker/index.ts`
- Test: `apps/live/test/worker/api.test.ts`, `apps/live/test/worker/socket.test.ts`

**Interfaces:**
- Consumes: Task 2〜4 のすべての関数、`quizPayloadSchema`
- Produces (HTTP):
  - Rails 向けの API（`Authorization: Bearer <ADMIN_API_SECRET>` が必要）:

    | メソッド・パス | 内容 | 応答 |
    |---|---|---|
    | `PUT /api/sessions/:sessionId` | body は `QuizPayload` | 作成すると 201、作成済みなら 409、検証エラーなら 422、認証エラーなら 401 |
    | `GET /api/sessions/:sessionId/ranking` | 全員の順位 | `{ phaseKey: string; final: boolean; players: RankedPlayer[] }`。未作成なら 404 |

  - WebSocket（未作成の sessionId なら 404、認証エラーなら 401）:

    | パス | 接続する側 |
    |---|---|
    | `GET /ws/:sessionId/host?token=<hostToken>` | 投影画面 |
    | `GET /ws/:sessionId/guest?playerToken=<token>` | ゲスト。初めての参加なら `playerToken` を付けない |

- Produces (`auth.ts`):
  - `hostTokenFor(secret: string, sessionId: string): Promise<string>`
  - `verifyBearer(req: Request, secret: string): boolean`
  - トークンの比較は定数時間で行う。
- Produces (DO): `class SessionRoom extends DurableObject<Env>` に次の 3 つを実装する。
  - `init(quiz: QuizPayload): Promise<"created" | "exists">`
  - `ranking(): Promise<{ phaseKey: string; final: boolean; players: RankedPlayer[] } | null>`
  - `fetch()` で WebSocket upgrade を受ける。
- DO 内の挙動:
  - **状態の保存**: `GameState` を `ctx.storage.kv` のキー `"state"` に保存する。constructor で同期的に読み込み、メモリに保持する。状態を変えるたびに書き込む。
  - **WebSocket の受け付け**: `ctx.acceptWebSocket(ws)` で受け付け、`ws.serializeAttachment({ role: "host" } | { role: "guest"; playerId: string | null })` で役割を記録する。
  - **ゲストの接続時**:
    - `playerToken` が見つかったら、その人の `guest_view` を送る。
    - 見つからない、または付いていなければ `need_join` を送る。
  - **メッセージの処理**:
    - `join` を受け付けられたら、`joined` を返し、続けて `guest_view` を送る。あわせて全ての host に送り直す。受け付けられなければ `join_error` を返す。
    - `answer` を受け付けたら、その本人と全ての host に送る。
    - `advance` は host からのみ受け付ける。状態が変わったら全員に送る。
    - それ以外のメッセージや、壊れた JSON は無視する。

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  // api.test.ts
  test("Bearer なしの PUT は 401、正しいと 201、2 回目は 409、不正 payload は 422", ...);
  test("未作成の ranking は 404", ...);
  test("host WebSocket は token 不一致で 401", ...);
  // socket.test.ts（SELF.fetch で Upgrade: websocket → resp.webSocket.accept()）
  test("ゲストが join → joined と lobby の guest_view が届き、host の playerCount が 1 になる", ...);
  test("host の advance(from:'lobby') で、ゲストに question の guest_view が届く", ...);
  test("同じ from での advance を 2 回送っても q:0:open のまま（ranking の phaseKey で確認）", ...);
  test("ゲストからの advance は無視", ...);
  test("知らない playerToken で接続すると need_join", ...);
  test("保存した playerToken で再接続すると、同じニックネーム・点数の guest_view", ...);
  test("DO を作り直しても状態が残る", () => {
    // runInDurableObject で ctx.storage.kv.get("state") の phase が進行後の値であることを確かめる。
    // さらに new SessionRoom(ctx, env) で作り直したインスタンスの ranking() が同じ結果を返すことを確かめる。
  });
  ```
- [ ] **Step 2: 実行して失敗を確認** — `pnpm --filter live exec vitest run -c vitest.workers.config.ts`。Expected: FAIL。
- [ ] **Step 3: 実装する** — DO の取得は `env.SESSION_ROOM.getByName(sessionId)` で行う。WebSocket upgrade は認証を済ませてから DO の `fetch` に渡す。`id` と `token` は `crypto.randomUUID()` で作る。
- [ ] **Step 4: 実行して成功を確認** — Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): SessionRoom durable object with websocket API`

---

### Task 6: ゲスト画面

**Files:**
- Create: `apps/live/src/client/use-live-socket.ts`, `apps/live/src/client/guest/GuestApp.tsx`, `apps/live/src/client/guest/*.tsx`（必要な分だけ）
- Modify: `apps/live/src/client/main.tsx`
- Test: `apps/live/test/client/use-live-socket.test.ts`（node 環境で、モックの WebSocket を使う）

**Interfaces:**
- Consumes: `GuestView`, `ServerMessage`, `ClientMessage`
- Produces:
  - `useLiveSocket(url: string): { last: ServerMessage | null; send(msg: ClientMessage): void; connected: boolean }`
    - 接続が切れたら自動で再接続する。待ち時間は 0.5 秒から始めて倍々にし、上限は 5 秒。
    - タブが表示状態に戻ったとき（`visibilitychange`）にも、すぐ再接続する。
  - localStorage のキー `makunouchi:${sessionId}:playerToken` に `playerToken` を保存する。

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  test("切断後 0.5s, 1s, 2s ... と再接続し、5s を超えない", ...);
  test("need_join を受け取ったら保存済み playerToken を消す", ...);   // 判定はフックの外の関数 handleGuestMessage に切り出して検証
  test("joined を受け取ったら playerToken を保存し、次回の接続 URL に付ける", ...);
  ```
- [ ] **Step 2: 実行して失敗を確認** — Expected: FAIL。
- [ ] **Step 3: 実装する** — スマホ縦向けの画面を作る。`GuestView.kind` ごとの表示は次のとおり。
  - `need_join`: ニックネームの入力フォーム。`join_error` の理由に応じて、次の文言を表示する。
    - `nickname_taken`: 「その名前は使われています」
    - `nickname_invalid`: 「1〜20 文字で入力してください」
    - `closed`: 「受付は終了しました」
  - `lobby`: 「まもなく始まります」
  - `question`:
    - `open` のときは A〜D の大きなボタンを並べ、選んだボタンを強調表示する。
    - `closed` のときは「締め切りました」と、自分が選んだ選択肢を表示する。
  - `reveal`: ⭕ または ❌ と、いまの点数。
  - `results_pending`: 「結果発表中…」
  - `final`: 「あなたは N 位（S 点）」
  - 接続が切れている間は、画面の上部に「再接続中…」を表示する。
- [ ] **Step 4: 実行して成功を確認** — テストを実行して PASS を確認する。さらに `pnpm --filter live dev` で、`/s/<id>` に 2 つのタブで参加し、ニックネームの重複と再読み込みからの復帰を手で確かめる（id は Task 5 の PUT で作る）。
- [ ] **Step 5: Commit** — `feat(live): guest mobile screens with auto-reconnect`

---

### Task 7: 投影画面（幹事の進行画面）

**Files:**
- Create: `apps/live/src/client/host/HostApp.tsx`, `apps/live/src/client/host/*.tsx`（必要な分だけ）
- Modify: `apps/live/src/client/main.tsx`

**Interfaces:**
- Consumes: `useLiveSocket`, `HostView`
- Produces: `/host/:sessionId?token=...` の画面

- [ ] **Step 1: 実装する** — プロジェクター向けに 16:9 の大きな文字で作る。進行ボタンは画面の右下に 1 つだけ置く。押すと `{ type: "advance", from: view.phaseKey }` を送る。キーボードの Space と → でも同じ操作になるようにする。
  - 各画面の表示とボタンの文言は次のとおり。

    | 画面 | 表示する内容 | ボタンの文言 |
    |---|---|---|
    | `lobby` | タイトル、ゲスト URL の QR コード（`qrcode.react`）、参加人数 | 「スタート」 |
    | `question`（open） | 第 N 問 / 全 M 問、タイトル、画像、A〜D、回答済み人数 / 参加人数 | 「回答を締め切る」 |
    | `question`（closed） | 同上 | 「正解を発表」 |
    | `reveal` | 正解の強調表示と、選択肢ごとの棒グラフ | 「次の問題へ」。最後の問題（`isLast`）では「結果発表へ」 |
    | `list` | 「4 位〜XX 位」の一覧 | 次の発表枠がある場合は「N 位を発表」 |
    | `podium`（伏せている） | 「？？？」 | 「めくる」 |
    | `podium`（めくった後） | 名前と点数（同点の人は全員並べる） | 次の発表枠がある場合は「N 位へ」。1 位をめくった後はボタンを消す |

  - ボタンの文言は `HostView.screen` から決まる（`list` と `podium` は `nextRank` を使う）。
  - 接続が切れたら「再接続中…」と表示し、ボタンを押せないようにする。
- [ ] **Step 2: 手で確認する** — `pnpm --filter live dev` で投影画面とゲスト 3 タブを開き、5 問を最後まで進める。4 位〜topN 位の一覧から 1 位をめくるところまで画面が切り替わることを確かめる。投影画面を再読み込みして、同じ段階から再開できることも確かめる。
- [ ] **Step 3: Commit** — `feat(live): projector host screens`

---

### Task 8: 負荷試験・デプロイ設定・開発用の問題データ

**Files:**
- Create: `apps/live/scripts/loadtest.ts`, `apps/live/scripts/seed-session.ts`, `apps/live/fixtures/sample-quiz.json`, `apps/live/README.md`

**Interfaces:**
- Consumes: Task 5 の HTTP / WebSocket API
- Produces:
  - `pnpm --filter live seed <baseUrl>`: `sample-quiz.json` を PUT して新しい sessionId を作る。ゲスト URL と投影画面 URL を表示する。
  - `pnpm --filter live loadtest <baseUrl> <sessionId> --clients 150`

- [ ] **Step 1: 負荷試験スクリプトを書く** — 処理の流れは次のとおり。
  1. Node の `ws` で 150 ゲストを join させる。
  2. host として接続し、`sample-quiz.json` の全問を進行させる。
  3. 各 open で、全ゲストにランダムな回答を送らせる。
  - 記録すること:
    - advance を送ってから、150 人全員に新しい `guest_view` が届くまでの最大時間（p100）
    - 取りこぼし（届かなかった人）の数
  - 合格の条件: すべての advance で、p100 が 2 秒以下かつ取りこぼし 0。
- [ ] **Step 2: 手元で実行する** — `pnpm --filter live dev` と `seed` を実行したあと、`loadtest http://localhost:5173 <id> --clients 150` を実行する。Expected: 「PASS」とその数値が出る。
- [ ] **Step 3: README を書く** — 次の内容を README にまとめる。
  - `wrangler secret put ADMIN_API_SECRET`
  - `pnpm --filter live deploy`
  - 本番環境での seed と loadtest の実行手順
  - 本番前のチェックリスト（リハーサル用の開催回を作ってから、本番用の開催回を作ること）
- [ ] **Step 4: Commit** — `chore(live): load test, seed script and deploy docs`

---

## Rails 側との受け渡し（次の計画への引き継ぎ）

Rails 側（`apps/admin`）の計画は別途作る。live 側が用意するものは次の 4 つ。

| 用途 | live 側が用意するもの |
|---|---|
| 開催回の開始 | `PUT /api/sessions/:sessionId` に `QuizPayload` を送る。sessionId は Rails が UUID で発行し、`description` は送らない |
| 投影画面 URL の生成 | `hostTokenFor(ADMIN_API_SECRET, sessionId)` と同じ HMAC を Rails でも計算する |
| 幹事のスマホでの順位表示 | `GET /api/sessions/:sessionId/ranking` |
| 最終結果の保存 | 同じ `GET /api/sessions/:sessionId/ranking` を使う。Rails 側で `final: true` を確認してから保存する |
