# 幹事画面と投影画面の分離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今の `/host/:id`（進行操作と投影を兼ねる画面）を、手元で操作する「幹事画面」（`/host/:id`）と、プロジェクターに映す「投影画面」（`/screen/:id`）の 2 つに分ける。投影画面は操作できず、幹事の操作に従って切り替わる。

**Architecture:** WebSocket の role に `screen` を足す（`host` / `screen` / `guest`）。投影画面にだけ、会場に映してよい内容の `ScreenView` を `screen_view` メッセージで送る。`HostView` は今のまま幹事の操作用に残す（この計画では形を変えない）。`SessionRoom.deliver()` に投影画面の列を足し、投影画面の認証は幹事とは別の派生トークンにする。

**Tech Stack:** Cloudflare Workers + Durable Object（WebSocket Hibernation）, Hono, React 19, Vitest（Node 環境 `test/game` `test/client`、Workers 環境 `test/worker`）

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`（2 章、4.2、6 章）と `docs/requirements/`（`行動シナリオ.md`、`UI作成.md`、スケッチ b2・b5）

## 実施順と依存関係（4 本共通）

| 順 | 計画 | 内容 | 主に触る共通ファイル |
|---|---|---|---|
| 0 | `2026-11-07-remove-points-and-topn.md` | points / topN の削除 | `shared/types.ts`（`QuizQuestion` / `QuizPayload`）、`payload.ts`、`scoring.ts`、`ranking.ts` |
| **1（この計画）** | `2026-11-07-split-host-and-screen.md` | 幹事画面と投影画面を分ける | `shared/types.ts`（`ScreenView` 追加）、`role.ts`、`auth.ts`、`index.ts`、`session-room.ts` の `deliver()`、`views.ts`（`screenView` 追加） |
| 3 | `2026-11-07-guest-answer-history.md` | 参列者の待機画面に回答一覧 | `shared/types.ts`（`GuestView`）、`views.ts`（`guestView`） |
| 2 | `2026-11-07-free-order-results.md` | 順位を好きな順に投影する | `shared/types.ts`（`Phase` / `HostView` / `ScreenView` / `ClientMessage`）、`state.ts`、`ranking.ts`、`rules.ts`、`session-room.ts` の `deliver()` |

実施順は **0 → 1 → 3 → 2**。Draft PR は `gh stack` で積む。

この計画を 2 番目にする理由と、衝突の避け方:
- 計画 2（自由順の順位発表）は「幹事の選択を投影画面に反映する」ので、投影画面という role と `deliver()` の投影画面の列が先に必要。したがって 1 → 2。
- `deliver()` は計画 1（投影画面の列を足す）と計画 2（`projection_changed` イベントを足す）の両方が触る。計画 1 で**列の形（hosts / screens / guests の 3 つのフラグ）**を決めておき、計画 2 はイベントの種類を 1 つ足すだけにする。
- 結果発表の旧画面（`list` / `podium`）は計画 2 で作り直すため、この計画では**そのまま `ScreenView` に写して**動く状態を保つ（計画 2 で消える。一時的な重複を許す）。`HostView` の形は変えないので、幹事側の結果画面は計画 2 まで今の `list` / `podium` のまま。
- `views.ts` は関数ごとに触る人が違う（`screenView` は計画 1、`guestView` は計画 3、結果の分岐は計画 2）ので、前の PR がマージされてからリベースすれば衝突しない。

## Global Constraints

- 幹事画面と投影画面は別の画面で、別のパソコンで開く。幹事画面は会場に映さない。投影画面は操作せず、幹事画面の操作に従って切り替わる。（設計書 4.2）
- 開始待機の投影画面には、参加用の QR コードと現在の参加人数を出す。（設計書 4.2 の 2）
- 進行状況はサーバー（DO）が持つ。幹事画面・投影画面が再読み込みしても、開き直せば進行中の状態から再開する。（設計書 4.5）
- 投影画面は参加者全員の目に入る。**正解（`correctIndex`）は正解発表の段階まで、順位と名前は投影された分しか送らない**（`ScreenView` に入れない）。
- `PhaseKey` のエンコーディングは変えない。投影画面の `advance` は受け付けない。
- 幹事のログイン方式の最終形（ID / PASS、`apps/admin`）は扱わない。当面はホストトークンのまま。
- 関数は `const` のアロー関数。分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネント。JSX は `return` の中だけ。ロジックは `useXxx.ts` か純関数に出す。三項演算子のネストは 1 段まで。（`CLAUDE.md`）
- 負荷: 1 開催回 120 人（試験は 150 接続）。投影画面は 1〜数台なので、投影画面への送信が進行を遅くしてはいけない（`answer_recorded` では送らない）。
- 範囲を広げない（MVP 期限 11/8）。

## Review Focus

1. **トークンの取り違え**: 幹事のトークンで投影画面に入れても、投影画面のトークンで幹事画面に入れてもいけない（投影画面のトークンは会場の PC に残る）。→ Task 1・Task 3。
2. **投影画面から操作できてしまう**: 投影画面の接続が `advance`（や将来の操作メッセージ）を送っても無視される。→ Task 3。
3. **正解の先出し**: 出題中・締め切り後の `screen_view` に `correctIndex` が含まれない。投影画面は誰でも開けるので漏れると全員に見える。→ Task 2。
4. **途中で開いた・再読み込みした投影画面**: 接続した時点で現在の `screen_view` が届く（`lobby` 以外の段階でも空白にならない）。→ Task 3。
5. **投影画面が複数台**: リハーサル用・予備の投影画面を同時に開いても、全員に同じ内容が届き、幹事の操作に影響しない。→ Task 3。
6. **負荷**: 回答が入るたびに投影画面へ送らない。参加が入ったときの投影画面への送信は `lobby` の間だけ。→ Task 3。

---

## ファイル構成

```
apps/live/
  src/shared/types.ts               # ScreenView 追加、ServerMessage に screen_view
  src/worker/role.ts                # Role = "host" | "screen" | "guest"
  src/worker/auth.ts                # screenTokenFor()
  src/worker/index.ts               # /ws/:id/screen を許可、role ごとにトークン検証
  src/worker/session-room.ts        # Attachment に screen、fetch、deliver に投影画面の列
  src/worker/game/views.ts          # screenView()
  src/client/main.tsx               # /screen/:id のルーティング
  src/client/token-store.ts         # resolveToken(): URL → sessionStorage（host / screen 共用）
  src/client/socket-url.ts          # buildSocketUrl(): host-action.ts の buildHostUrl を一般化
  src/client/screen/                # 投影画面（host/screens/* と FittedList / useFitToBox / QuestionBlock を移す）
    ScreenApp.tsx, ScreenContent.tsx, useScreenSession.ts
    screens/{LobbyScreen,QuestionScreen,RevealScreen,PodiumScreen}.tsx, FittedList.tsx, useFitToBox.ts, QuestionBlock.tsx
  src/client/host/                  # 幹事画面（操作と確認だけの小さな画面に作り直す）
    HostApp.tsx, HostPanel.tsx, useHostSession.ts, host-action.ts
  scripts/seed-session.ts           # 幹事画面 URL と投影画面 URL の両方を表示
  README.md, ../../CLAUDE.md        # URL の説明を更新
  test/game/{auth,views}.test.ts, test/worker/{api,socket,load,helpers}.ts, test/client/{token-store,socket-url,host-action}.test.ts
```

---

### Task 1: 投影画面用のトークン

**Files:**
- Modify: `apps/live/src/worker/auth.ts`
- Test: `apps/live/test/game/auth.test.ts`

**Interfaces:**
- Produces: `screenTokenFor(secret: string, sessionId: string): Promise<string>` — `HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)` の hex（64 文字）。`hostTokenFor` と同じく、秘密が短ければ例外を投げる。`"screen:"` を前置するので、`hostTokenFor` の入力（UUID の開催回 ID）とは決して一致しない。Rails も同じ計算をする。

- [ ] **Step 1: 失敗するテストを書く**
  - 「64 文字の hex で、同じ入力なら同じ値」
  - 「同じ開催回でも `screenTokenFor(secret, id) !== hostTokenFor(secret, id)`」
  - 「開催回が違えば値も違う」
  - 「短い秘密は例外（`hostTokenFor` と同じメッセージ）」
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run test/game/auth.test.ts`。Expected: FAIL（`screenTokenFor` が未定義）。
- [ ] **Step 3: 実装** — `auth.ts` に `screenTokenFor` を追加（既存の `hmacHex` と `isUsableSecret` を使う）。
- [ ] **Step 4: 実行して成功を確認** — 同じコマンド。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 投影画面用の派生トークンを追加`

---

### Task 2: 投影画面に送る内容（`ScreenView` と `screenView()`）

**Files:**
- Modify: `apps/live/src/shared/types.ts`, `apps/live/src/worker/game/views.ts`
- Test: `apps/live/test/game/views.test.ts`

**Interfaces:**
- Produces（`shared/types.ts`）:
  ```ts
  export type ScreenView =
    | { kind: "lobby"; title: string; playerCount: number }
    | { kind: "question"; question: PublicQuestion; status: "open" | "closed" }
    | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; counts: [number, number, number, number] }
    // 計画 2 で作り直す。それまで今の結果発表を投影画面にそのまま映す。
    | { kind: "list"; entries: { rank: number; nickname: string; score: number }[] }
    | { kind: "podium"; rank: PodiumRank; revealed: boolean; players: { nickname: string; score: number }[] };
  ServerMessage に { type: "screen_view"; view: ScreenView } を追加
  ```
- Produces（`views.ts`）: `screenView(s: GameState): ScreenView`。`hostView` と同じ状態から作る。回答済み人数（`answeredCount`）は入れない（幹事画面だけに出す。投影画面に出すと回答のたびに再送が要るため）。`list` / `podium` の組み立ては `hostView` と同じ値を使う（重複する部分は小さな内部関数にまとめてよい）。
- Consumes: 既存の `rankPlayers` / `listEntries` / `podiumPlayers` / `nextPodiumRank`。

- [ ] **Step 1: 失敗するテストを書く**（`views.test.ts` に `describe("screenView")`）
  - `lobby`: `{ kind: "lobby", title, playerCount }`（参加が増えると `playerCount` が増える）。
  - `question`: `open` と `closed` で `status` が変わり、`JSON.stringify(view)` に `correctIndex` が含まれない（既存の「answer leakage」のテストに screen を加える）。
  - `question`: `answeredCount` が存在しない（`expect(view).not.toHaveProperty("answeredCount")`）。
  - `reveal`: `correctIndex` と、選択肢ごとの `counts`（回答 `[2,1,0,0]` なら `[2,1,0,0]`）。
  - `podium` で `revealed=false` の間は `players` が空で、ニックネームが JSON に含まれない（`hostView` の既存テストと同じ観点）。
  - `list`: 4 位以降が入る。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/game/views.test.ts`。Expected: FAIL（`screenView` が未定義）。
- [ ] **Step 3: 実装** — `ScreenView` と `screen_view` の型を足し、`screenView` を実装する。
- [ ] **Step 4: 実行して成功を確認** — `pnpm exec vitest run test/game/views.test.ts && pnpm typecheck`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 投影画面に送る ScreenView を追加`

---

### Task 3: Worker と DO に `screen` role を足す

**Files:**
- Modify: `apps/live/src/worker/role.ts`, `apps/live/src/worker/index.ts`, `apps/live/src/worker/session-room.ts`
- Modify（テスト用の補助）: `apps/live/test/worker/helpers.ts`
- Test: `apps/live/test/worker/api.test.ts`, `apps/live/test/worker/socket.test.ts`, `apps/live/test/worker/load.test.ts`

**Interfaces:**
- Consumes: `screenTokenFor`（Task 1）、`screenView`（Task 2）。
- Produces:
  - `role.ts`: `export type Role = "host" | "screen" | "guest"`（`ROLE_HEADER` は今のまま）。
  - `index.ts`: `GET /ws/:sessionId/screen?token=...` を `host` と同様に `requireAdminSecret` で守り、`screenTokenFor` と比較する。`host` は `hostTokenFor` のまま。role は Worker が決めて `ROLE_HEADER` に入れる（クライアントの値は上書き）。
  - `session-room.ts`: `Attachment = { role: "host" } | { role: "screen" } | GuestAttachment`。接続時に `screen_view` を 1 通送る。`screen` から届くメッセージはすべて無視。
  - `deliver()` の送り先（コメントの表もこれに合わせて更新）:

    | イベント | 幹事 | 投影画面 | 参列者 |
    |---|---|---|---|
    | `phase_changed` | `host_view` | `screen_view` | 参加済み全員に `guest_view` |
    | `player_joined` | `host_view` | `screen_view`（フェーズが `lobby` のときだけ） | 本人に `guest_view` |
    | `answer_recorded` | `host_view` | なし | 本人に `guest_view` |

    実装は、今ある `hosts` / `allGuests` と同じ形で `screens` フラグを足す。
  - テスト補助: `connectScreen(sessionId: string): Promise<Client>`（`screenTokenFor` でトークンを作る）。`ServerMessage` の型に `screen_view` が増えるので `Client.next("screen_view")` が使える。

- [ ] **Step 1: 失敗するテストを書く**
  - `api.test.ts`:
    - 「投影画面の WebSocket はトークンなしで 401」「間違ったトークンで 401」
    - 「**幹事のトークンで `/screen` に入れない**（401）」「**投影画面のトークンで `/host` に入れない**（401）」
    - 「未作成の開催回の `/screen` は 404」（既存の「WebSocket to uncreated session」に並べる）
  - `socket.test.ts`:
    - 「投影画面に接続すると、すぐに `screen_view`（`lobby`、`playerCount` つき）が届く」
    - 「`/screen` に偽の `ROLE_HEADER: host` を付けても、投影画面として扱われる」（既存の role forwarding のテストを 3 role に広げる）
    - 「投影画面が `advance` を送っても進行は変わらない」（幹事に `host_view` が届かず、`ranking` API の `phaseKey` が `lobby` のまま）
    - 「幹事が `advance` すると、投影画面に `screen_view`（`question` / `open`）が届き、その JSON に `correctIndex` がない」
    - 「回答が入っても投影画面には何も届かない」: 参加者が `answer` を送ったあと、幹事には `host_view` が届くが、投影画面の `messages.length` は増えない。
    - 「参加者が入ると、`lobby` の間は投影画面に `playerCount` が増えた `screen_view` が届く。スタート後に途中参加しても届かない」
    - 「投影画面を 2 台つないでも、どちらにも同じ `screen_view` が届く」
    - 「問題の途中（`q:1:closed`）で投影画面を開くと、その段階の `screen_view` が届く」
    - 「DO を作り直しても（`state survives re-creating the Durable Object` と同じやり方）、投影画面の再接続で同じ `screen_view` が届く」
  - `load.test.ts`: 150 ゲスト + 1 幹事に **投影画面 1 台**を足し、`driveQuiz` の各 advance で投影画面にも `screen_view` が届くこと（2000 ms 以内）を確認する。`src/loadtest/drive.ts` は変えず、テスト側で投影画面の受信を数える。
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run --config vitest.workers.config.ts test/worker`。Expected: FAIL（`/screen` が 404、`connectScreen` 未定義）。
- [ ] **Step 3: 実装** — `index.ts`: role の判定を `host` / `screen` / `guest` に広げ、`requireAdminSecret` を `host` と `screen` の両方に適用、トークンは role ごとに計算。`session-room.ts`: 上の仕様どおり。`webSocketMessage` の switch は `att.role === "host"` / `"guest"` のまま（`screen` はどの case にも入らない）。
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): screen role と投影画面への配信を追加`

---

### Task 4: 投影画面のクライアント（`/screen/:id`）

**Files:**
- Create: `apps/live/src/client/token-store.ts`, `apps/live/src/client/socket-url.ts`, `apps/live/src/client/screen/ScreenApp.tsx`, `apps/live/src/client/screen/ScreenContent.tsx`, `apps/live/src/client/screen/useScreenSession.ts`
- Move（`git mv`）: `host/screens/{LobbyScreen,QuestionScreen,RevealScreen,PodiumScreen}.tsx` → `screen/screens/`、`host/{FittedList.tsx,useFitToBox.ts,QuestionBlock.tsx}` → `screen/`。型 `HostScreenOf` は `ScreenView` 用の `ScreenOf<K>` を `screen/types.ts` に作って置き換える。
- Modify: `apps/live/src/client/main.tsx`（ルーティングとトークン処理）, `apps/live/src/client/host/host-action.ts`（`buildHostUrl` を `socket-url.ts` へ）
- Test: `apps/live/test/client/token-store.test.ts`, `apps/live/test/client/socket-url.test.ts`, `apps/live/test/client/host-action.test.ts`

**Interfaces:**
- Produces:
  - `resolveToken(role: "host" | "screen", sessionId: string, io: { search: string; pathname: string; hash: string; storage: Pick<Storage, "getItem" | "setItem"> | null; replaceUrl(url: string): void }): string` — URL の `token` を sessionStorage（キー `makunouchi:<sessionId>:<role>Token`）に移し、アドレスバーから消し、トークンを返す。URL になければ storage から読む。storage が使えなくても例外にせず、URL のトークンだけ返す。`main.tsx` から `window.location` / `sessionStorage` / `history.replaceState` を渡して呼ぶ。host と screen のキーは別（片方の保存値がもう片方に使われない）。
  - `buildSocketUrl(loc: { protocol: string; host: string }, role: "host" | "screen", sessionId: string, token: string): string` — `ws(s)://<host>/ws/<id>/<role>?token=<token>`（`encodeURIComponent`）。`https:` なら `wss`。
  - `useScreenSession(sessionId: string, token: string): { view: ScreenView | null; connected: boolean }` — `useLiveSocket` を使い、`screen_view` だけを反映する。
  - `ScreenApp({ sessionId, token })` は「どの画面を出すか」だけ決める。`ScreenContent({ view, sessionId })` が `view.kind` の `switch` で各 `*Screen` を返す。`LobbyScreen` は今と同じ QR（`/s/<sessionId>`）と参加人数。接続中・再接続中の表示は今の `host-banner` と同じ。

- [ ] **Step 1: 失敗するテストを書く**
  - `token-store.test.ts`: 「URL の `token` を storage に保存し、`replaceUrl` で `token` を消した URL（他のクエリとハッシュは残す）にして返す」「URL になければ storage の値を返す」「`host` と `screen` で保存が別」「`storage: null` でも URL のトークンを返す」「どちらもなければ空文字」
  - `socket-url.test.ts`: 「`host` / `screen` で `/ws/<id>/<role>?token=` になる」「`https:` は `wss`」「記号はエンコードされる」
  - `host-action.test.ts`: 既存の `buildHostUrl` のテストを `buildSocketUrl` に移す。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client`。Expected: FAIL（モジュールがない）。
- [ ] **Step 3: 実装** — 純関数 2 つを実装。画面部品を移し、`ScreenApp` / `ScreenContent` / `useScreenSession` を作る。`main.tsx` の `Router` は `parts[0] === "screen"` で `ScreenApp` を返し、`resolveHostToken` は `resolveToken` の呼び出しに置き換える。投影画面の「回答済み n / m 人」は出さない（`QuestionScreen` から外す）。
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: 目視確認** — `cp .dev.vars.sample .dev.vars && pnpm dev` を起動し、`pnpm seed http://localhost:5173`（Task 5 の後に URL が出る。Task 5 より先に確認するなら `curl` で `PUT` して手で URL を組み立てる）で作った開催回に、投影画面を開いて「参加用 QR と人数 → 問題 → 正解発表」が映り、操作ボタンがないことを確認する。
- [ ] **Step 6: Commit** — `feat(live): 投影画面（/screen/:id）を追加`

---

### Task 5: 幹事画面を操作用に作り直す・文書とスクリプトの更新

**Files:**
- Modify: `apps/live/src/client/host/HostApp.tsx`, `apps/live/src/client/host/useHostSession.ts`
- Create: `apps/live/src/client/host/HostPanel.tsx`
- Delete: `apps/live/src/client/host/HostScreen.tsx`（`HostPanel` に置き換え）
- Modify: `apps/live/src/client/host/host-action.ts`, `apps/live/scripts/seed-session.ts`, `apps/live/README.md`, `CLAUDE.md`
- Test: `apps/live/test/client/host-action.test.ts`

**Interfaces:**
- Consumes: `buildSocketUrl`、`resolveToken`（Task 4）。`HostView` は変えない。
- Produces: `HostPanel({ view }: { view: HostView | null })` — 幹事が見る小さな状態表示。`view.screen.kind` の `switch` で次を返す（装飾は最小限。大きな文字・QR・棒グラフは投影画面の役割）:
  - `lobby`: タイトル、参加人数
  - `question`: 何問目（`question.index + 1` / `total`）、問題文、選択肢、`回答済み answeredCount / playerCount 人`
  - `reveal`: 何問目、問題文、正解の選択肢、選択肢ごとの回答人数（`counts`）
  - `list` / `podium`: 今の `list` / `podium` の内容を文字で並べる（計画 2 で作り直す）
- `useHostSession` は URL 生成を `buildSocketUrl(window.location, "host", ...)` にする。進行ボタン（`hostActionLabel` / `AdvanceGate`）は今のまま。

- [ ] **Step 1: 失敗するテストを書く** — `host-action.test.ts`: `hostActionLabel` は変えない（既存テストが通り続けること）。`seed-session.ts` を純関数に切り出す必要はない（URL の組み立て 2 行）。幹事画面のコンポーネントの見た目にテストは書かない。
- [ ] **Step 2: 実装** — `HostScreen` を `HostPanel` に置き換える。`HostApp` は `useHostSession` の結果から、再接続バナー・`HostPanel`・進行ボタンを並べるだけ。`seed-session.ts` は次の 3 行を出す: `ゲスト URL`、`幹事画面 URL: /host/<id>?token=<hostToken>`、`投影画面 URL: /screen/<id>?token=<screenToken>`（`screenTokenFor` を使う）。`README.md` と `CLAUDE.md` の「`/host/:id`（投影画面兼進行操作）」の記述、`GET /ws/:id/host?token=...` の節に `screen` を足す。
- [ ] **Step 3: 全体を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。続けて `pnpm dev` と `pnpm seed` で、幹事画面（ボタン操作）と投影画面（別タブ）が連動して切り替わること、幹事画面に QR や大きな表示がないことを目視する。
- [ ] **Step 4: Commit** — `feat(live): 幹事画面を操作用に作り直し、seed が両方の URL を表示`

---

## ユーザーに確認すること

1. **投影画面の認証**（既定は B）
   - A. 認証なし（ゲストと同じ）。URL を知っている人は誰でも開ける。投影画面に出る内容は会場に映す内容だけなので漏れて困る情報は少ないが、第三者が接続数を増やせる。
   - **B. 幹事とは別の派生トークン（推奨）**: `HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)`。投影画面用の PC に残るのは読み取り専用の資格情報だけで、操作側（幹事トークン）には使えない。実装は `screenTokenFor` 1 つで、Rails も同じ計算をする。
   - C. 幹事のトークンをそのまま使う。実装は最小だが、会場の PC に操作権限つきのトークンが残る。
2. **投影画面の URL**: `/screen/:id`（推奨。幹事画面の `/host/:id` と対になる）か、`/projector/:id` か。
3. **投影画面に「回答済み n / m 人」を出すか**（既定は出さない）。要件では回答人数は幹事画面の表示（`UI作成.md` の問題表示画面）で、投影画面には問題と結果を映す。出す場合は `answer_recorded` でも投影画面に送ることになり、回答のたびに 1 通増える（120 人で 120 通）。
4. （情報）幹事画面から投影画面の URL を開けるようにはしない。URL は `seed`（将来は Rails）が発行して、投影画面用の PC で直接開く。

## 作業量の見積もり

約 4〜6 時間。Task 1: 20 分、Task 2: 45 分、Task 3: 1.5〜2 時間（Workers テストが多い）、Task 4: 1.5 時間（部品の移動とトークン処理）、Task 5: 1 時間。計画 2 がこの上に乗るので、先にここを安定させる。
