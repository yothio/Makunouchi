# 順位を好きな順に投影する Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 結果発表を「幹事が順位一覧から好きな人を選び、その人の『順位』と『名前』を別々のボタンで投影し、『戻る』で一覧に戻って次の人を選ぶ」形に作り直す。発表の順番はシステムで決めない。

**Architecture:** 結果フェーズ（`results`）の中身を、固定の「一覧 → 3・2・1 位」から「一覧 / 選んだ人（順位と名前を投影したかどうか）」に置き換える。結果フェーズの操作は新しいメッセージ `results_action` で送り、冪等性は問題フェーズと同じく「いまの `PhaseKey` を `from` に付けて送り返す」方式で保つ。問題フェーズ（`lobby` / `q:<i>:<open|closed|revealed>`）の `PhaseKey` は変えない。結果の操作は幹事と投影画面にだけ届け、参列者には送らない。

**Tech Stack:** TypeScript, zod, Cloudflare Durable Object, React 19, Vitest（Node 環境 `test/game` `test/client`、Workers 環境 `test/worker`）

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`（4.2 の 5・6、8 章「決定済み（2026-11-07）」）、`docs/requirements/UI作成.md`（順位一覧表示画面・順位表示画面）、スケッチ b5

## 実施順と依存関係（4 本共通）

| 順 | 計画 | 内容 | 主に触る共通ファイル |
|---|---|---|---|
| 0 | `2026-11-07-remove-points-and-topn.md` | points / topN の削除 | `shared/types.ts`（`QuizQuestion` / `QuizPayload`）、`payload.ts`、`scoring.ts`、`ranking.ts` |
| 1 | `2026-11-07-split-host-and-screen.md` | 幹事画面と投影画面を分ける | `shared/types.ts`（`ScreenView`）、`role.ts`、`auth.ts`、`index.ts`、`session-room.ts` の `deliver()`、`views.ts`（`screenView`） |
| 3 | `2026-11-07-guest-answer-history.md` | 参列者の待機画面に回答一覧 | `shared/types.ts`（`GuestView`）、`views.ts`（`guestView`） |
| **2（この計画）** | `2026-11-07-free-order-results.md` | 順位を好きな順に投影する | `shared/types.ts`（`Phase` / `HostView` / `ScreenView` / `ClientMessage`）、`state.ts`、`ranking.ts`、`rules.ts`、`session-room.ts` の `deliver()` |

実施順は **0 → 1 → 3 → 2**。Draft PR は `gh stack` で積む。この計画が最後になる理由と衝突の避け方:

- **計画 1 が先に要る**: 「幹事が選んだ内容を投影画面に映す」には、投影画面の role・`ScreenView`・`deliver()` の投影画面の列が必要。この計画はそれを前提に `ScreenView` の `list` / `podium` を消して作り直す。
- **計画 3 が先に要る**: 今の `guestView` は `isFinal(phase, ranked)` と順位で結果の段階を見ている。計画 3 で参列者の結果の段階を `results_pending` 1 つ（順位なし）にしておけば、この計画は `isFinal` / `nextPodiumRank` / `podiumPlayers` などを遠慮なく消せる。
- **`deliver()` の変更は 1 点だけ**: イベントに `projection_changed` を足し、「幹事と投影画面にだけ送る」行を 1 つ増やす。列（hosts / screens / guests）の形は計画 1 で決めてあるので、衝突しない。
- **`types.ts`**: この計画が触るのは `Phase` の `results`、`HostView` / `ScreenView` の結果の 2 種類、`ClientMessage`、`PodiumRank` / `ResultsStage` の削除。計画 0・1・3 が触った箇所（`QuizQuestion`、`ScreenView` の他の kind、`GuestView`）には触れない。

## Global Constraints

- 幹事画面の順位一覧には、全員のニックネームと順位を出す。選んだ人の順位表示では、「順位を投影」「名前を投影」のボタンで**別々に**投影する。「戻る」で順位一覧に戻り、次の人を選ぶ。（設計書 4.2 の 5・6、`UI作成.md`）
- 発表の順番はシステムで決めない（式ごとに発表する順位が違う）。幹事は、好きな人を好きな順に、何人でも投影できる。
- 同点は同じ順位（競技方式: 90, 90, 80 → 1, 1, 3 位）。同順位の人は別々の人として個別に選んで投影する。
- 点数は正解数（計画 0）。出題順は作成順。
- **`PhaseKey` のエンコーディングのうち、問題フェーズ（`lobby`、`q:<i>:<open|closed|revealed>`）は変えない。** 結果フェーズは作り直してよい（`r:list` / `r:<rank>:<hidden|shown>` は廃止）が、`advance.from` と同じ「いまの段階のキーを付けて送り返し、一致したときだけ進める」冪等性は保つ。
- 順位発表が始まったら参加を締め切る（`results` の間の `join` は `closed`。既存の仕様）。
- 投影画面には、**投影した分だけ**を送る（投影前の順位・名前を `ScreenView` に入れない）。参列者には結果の操作を送らない。
- 進行状況はサーバーが持つ。幹事画面・投影画面が再読み込みしても、選択中の人と投影済みの内容が復元される。
- 関数は `const` のアロー関数。分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネント。JSX は `return` の中だけ。ロジックは `useXxx.ts` か純関数に出す。（`CLAUDE.md`）
- 範囲を広げない（MVP 期限 11/8）。幹事のログイン方式の最終形、`apps/admin` は扱わない。

## 設計: 結果フェーズの状態・`PhaseKey`・操作

```ts
// shared/types.ts
export type ResultsStage =
  | { kind: "list" }
  | { kind: "player"; playerId: string; rankShown: boolean; nameShown: boolean };

export type ResultsAction =
  | { kind: "select"; playerId: string }
  | { kind: "show_rank" }
  | { kind: "show_name" }
  | { kind: "back" };

// ClientMessage に追加
| { type: "results_action"; from: PhaseKey; action: ResultsAction }
```

**結果フェーズの `PhaseKey`**（`phaseKey()` が状態から作る。サーバーは文字列の一致だけを見る）:

| 状態 | キー |
|---|---|
| 一覧 | `r:list` |
| 選んだ人（まだ何も投影していない） | `r:<playerId>:hidden` |
| 順位だけ投影済み | `r:<playerId>:rank` |
| 名前だけ投影済み | `r:<playerId>:name` |
| 両方投影済み | `r:<playerId>:both` |

`playerId` は UUID（`crypto.randomUUID()`）で `:` を含まないので、キーを分解しなくても一致判定だけで足りる。

**冪等性**: `advance` と同じく、`results_action.from` が「いまのキー」と一致したときだけ適用する。受理された操作は必ずキーを変える（`select` は `r:list` → `r:<id>:hidden`、`show_rank` は `hidden→rank` か `name→both`、`show_name` は `hidden→name` か `rank→both`、`back` は `r:<id>:*` → `r:list`）ので、二度押し・2 つのタブからの同時操作・再送では 2 回目が `stale_phase` になって無視される。すでに投影済みのものを再度送った場合は `no_change`（状態を変えない）。

**問題フェーズからの入口**: 最後の問題の `q:<n-1>:revealed` で `advance` を送ると `r:list` になる（`advance` の経路と `q:` のキーは変えない）。結果フェーズの中での `advance` は `no_next_stage`（受け付けない）。

**配信**: 新しいイベント `{ type: "projection_changed" }` を足す。`deliver()` は幹事に `host_view`、投影画面に `screen_view` を送り、**参列者には送らない**（参列者の `guest_view` は結果の段階で変わらない）。

**ビュー**:

- `HostView.screen`（結果の 2 種類。`list` / `podium` は削除）
  - `{ kind: "ranking"; entries: { playerId: string; rank: number; nickname: string; score: number }[] }` — 全員。順位の昇順、同順位は参加順。
  - `{ kind: "ranking_detail"; playerId: string; rank: number; nickname: string; score: number; rankShown: boolean; nameShown: boolean }`
- `ScreenView`（`list` / `podium` は削除）
  - `{ kind: "results_wait"; title: string }` — 一覧にいる間、または選んだ人を何も投影していない間（「結果発表」の待ち画面）。
  - `{ kind: "rank_reveal"; rank: number | null; nickname: string | null }` — `rankShown` のときだけ `rank`、`nameShown` のときだけ `nickname` が入る。それ以外は `null`。両方 `null` のときは `results_wait` にする。

## Review Focus

1. **投影前のネタバレ**: `rankShown` が `false` の間、投影画面の `screen_view` に順位が、`nameShown` が `false` の間はニックネームが JSON に含まれない（片方だけ投影した状態を含む）。→ Task 3。
2. **二度押し・同時操作**: `select` や `show_rank` を同じ `from` で 2 回送っても 1 回しか効かない。2 つの幹事タブから別々の人を同時に選んでも、先に届いた方だけが効き、もう片方は無視される（状態が壊れない）。→ Task 1・Task 4。
3. **結果の操作が参列者に届かない**: 選択・投影のたびに 120 人へ送らない（負荷と、選択中の人が参列者の通信に出ないこと）。→ Task 4。
4. **権限**: 投影画面・参列者が `results_action` を送っても無視される。幹事でも `results` 以外のフェーズでは受理されない。→ Task 4。
5. **不正な入力**: 存在しない `playerId` の `select`、`select` の `playerId` 欠落、未知の `action.kind` は状態を変えず、接続も落とさない。→ Task 1・Task 2。
6. **再読み込み・DO の再起動**: 選択中の人と投影済みの内容が保存され、幹事・投影画面を開き直すと同じ表示に戻る。→ Task 4。
7. **同順位**: 1 位が 2 人いても、それぞれを別々に選んで投影できる。人数ゼロ（誰も参加していない）の結果フェーズでも落ちない。→ Task 1・Task 3。
8. **Rails 向け `GET /api/sessions/:id/ranking`**: `final` の意味が変わる（下記）。→ Task 4。

---

## ファイル構成

```
apps/live/
  src/shared/types.ts               # ResultsStage / ResultsAction 作り直し、PodiumRank 削除、HostView / ScreenView の結果、ClientMessage
  src/worker/messages.ts            # results_action の zod
  src/worker/game/state.ts          # phaseKey()、presentResults()、nextPhase の results を削除
  src/worker/game/ranking.ts        # listEntries / podiumPlayers / podiumHasPlayers / nextPodiumRank / isFinal を削除
  src/worker/game/rules.ts          # PODIUM_RANKS / LIST_FIRST_RANK を削除
  src/worker/game/views.ts          # hostView / screenView の結果の分岐
  src/worker/session-room.ts        # onResultsAction、deliver に projection_changed、ranking() の final
  src/client/host/ResultsPanel.tsx（一覧）, RankDetailPanel.tsx, host-action.ts, useHostSession.ts, HostPanel.tsx
  src/client/screen/ScreenContent.tsx, screens/RankRevealScreen.tsx, screens/ResultsWaitScreen.tsx
  src/client/screen/{FittedList.tsx,useFitToBox.ts}, screens/PodiumScreen.tsx   # 削除
  src/client/styles.css
  test/game/{state,ranking,views,messages}.test.ts, test/worker/{socket,api,load}.test.ts, test/client/host-action.test.ts
```

---

### Task 1: 結果フェーズの状態遷移（純関数）と `PhaseKey`

**Files:**
- Modify: `apps/live/src/shared/types.ts`（`ResultsStage`、`ResultsAction`、`PodiumRank` の削除）, `apps/live/src/worker/game/state.ts`, `apps/live/src/worker/game/rules.ts`
- Test: `apps/live/test/game/state.test.ts`

**Interfaces:**
- Produces:
  - `phaseKey(phase: Phase): PhaseKey` — 上の表のとおり。`lobby` / `q:<i>:<status>` は**変えない**。
  - `presentResults(s: GameState, fromKey: PhaseKey, action: ResultsAction): Transition<"stale_phase" | "not_in_results" | "unknown_player" | "invalid_action" | "no_change">` — 仕様:
    - `s.phase.type !== "results"` → `not_in_results`
    - `fromKey !== phaseKey(s.phase)` → `stale_phase`
    - `select`: 一覧にいて、`playerId` が参加者にいれば `player` に（`rankShown: false, nameShown: false`）。参加者にいなければ `unknown_player`。一覧にいなければ `invalid_action`。
    - `show_rank` / `show_name`: `player` にいるときだけ。すでに `true` なら `no_change`。`player` にいなければ `invalid_action`。
    - `back`: `player` にいるときだけ `list` に。一覧にいれば `invalid_action`。
    - 受理時の `events` は `[{ type: "projection_changed" }]`。
  - `GameEvent` に `{ type: "projection_changed" }` を足す。
  - `advance(s, fromKey)` — `nextPhase` の `results` 分岐を削除し、`results` のときは `no_next_stage`。最後の問題の `revealed` から `{ type: "results", stage: { kind: "list" } }` へ進むのは今のまま。
  - `rules.ts` から `PODIUM_RANKS` / `LIST_FIRST_RANK` を削除。

- [ ] **Step 1: 失敗するテストを書く**（`state.test.ts`。`results progression` の describe を置き換える。以下はテスト名と主な assertion）
  - 「問題フェーズの `phaseKey` は変わらない」: `lobby`、`q:0:open`、`q:3:closed`、`q:14:revealed`（既存の「phaseKey の形式」を残す）。
  - 「結果フェーズの `phaseKey`: `r:list`、`r:<id>:hidden`、`:rank`、`:name`、`:both`」
  - 「最後の問題の `revealed` から `advance` すると `r:list`」「`r:list` からの `advance` は `no_next_stage`」
  - 「`select`（`from: "r:list"`）で `r:<id>:hidden` になり、`events` が `projection_changed`」
  - 「`select` を同じ `from` で 2 回送ると、2 回目は `stale_phase` で状態が変わらない」
  - 「存在しない `playerId` の `select` は `unknown_player`、状態は変わらない」
  - 「`show_rank` → `r:<id>:rank`、続けて `show_name`（`from: ":rank"`）→ `:both`」「`show_name` → `show_rank` の順でも `:both`」
  - 「`show_rank` を同じ `from` で 2 回 → 2 回目は `stale_phase`」「`:rank` の状態に `from: ":rank"` で `show_rank` → `no_change`」
  - 「`back` で `r:list` に戻る。`players` と `answers` は変わらない」「一覧での `back` は `invalid_action`」
  - 「`select` した後、`from: "r:list"` で別の人を `select` すると `stale_phase`（先に選んだ人が残る）」
  - 「`results` 以外のフェーズでの `presentResults` は `not_in_results`」
  - 「参加者ゼロの `results` でも `advance` で入れて、`select` は `unknown_player`」
  - 既存の「`results` 中の参加は `closed`」「`scoreOf` は `results` で全問採点」は残す。
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run test/game/state.test.ts`。Expected: FAIL（`presentResults` が未定義、`PodiumRank` に依存する旧テスト）。
- [ ] **Step 3: 実装** — 型を直し、`phaseKey` と `presentResults` を実装し、`nextPhase` の `results` 分岐を削除する。この時点で `ranking.ts` / `views.ts` / `session-room.ts` が旧型に依存して typecheck が落ちるので、**Task 2・Task 4 の後でまとめて通す**（Task 1 のコミットでは `vitest run test/game/state.test.ts` だけを通せばよい。typecheck を通したいなら、このタスクの中で旧型を残して Task 2 で消してもよい）。
- [ ] **Step 4: 実行して成功を確認** — `pnpm exec vitest run test/game/state.test.ts`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 結果フェーズを選択と投影の状態遷移に作り直す`

---

### Task 2: メッセージと、順位計算の整理

**Files:**
- Modify: `apps/live/src/shared/types.ts`（`ClientMessage`）, `apps/live/src/worker/messages.ts`, `apps/live/src/worker/game/ranking.ts`
- Test: `apps/live/test/game/messages.test.ts`, `apps/live/test/game/ranking.test.ts`

**Interfaces:**
- Produces:
  - `ClientMessage` に `{ type: "results_action"; from: PhaseKey; action: ResultsAction }`。
  - `clientMessageSchema` に `results_action` を追加。`action` は `kind` で判別する discriminated union（`select` は `playerId: string` 必須、`show_rank` / `show_name` / `back` は `kind` のみ）。**未知の `kind` や `playerId` 欠落は `parseClientMessage` が `null` を返す**。
  - `ranking.ts`: `rankPlayers` は残し、`listEntries` / `podiumPlayers` / `podiumHasPlayers` / `nextPodiumRank` / `isFinal` を削除する。

- [ ] **Step 1: 失敗するテストを書く**
  - `messages.test.ts`: 「`results_action` の 4 種類が通る」「`select` の `playerId` なしは `null`」「未知の `kind` は `null`」「`from` なしは `null`」
  - `ranking.test.ts`: `rankPlayers` のテスト（同点で `1, 1, 3`、同点は参加順）は残し、削除した関数のテストを消す。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/game/messages.test.ts test/game/ranking.test.ts`。Expected: FAIL（新メッセージが `null` になる）。
- [ ] **Step 3: 実装**
- [ ] **Step 4: 実行して成功を確認** — 同じコマンド。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): results_action メッセージを追加し、固定の発表順の計算を削除`

---

### Task 3: 幹事と投影画面に送るビュー

**Files:**
- Modify: `apps/live/src/shared/types.ts`（`HostView` / `ScreenView` の結果）, `apps/live/src/worker/game/views.ts`
- Test: `apps/live/test/game/views.test.ts`

**Interfaces:**
- Produces: 上の「設計」の `HostView.screen`（`ranking` / `ranking_detail`）と `ScreenView`（`results_wait` / `rank_reveal`）。`hostView(s)` / `screenView(s)` が `results` フェーズで返す。`playerId` が見つからない（通常は起きない）ときは `ranking`（一覧）にフォールバックし、例外を投げない。

- [ ] **Step 1: 失敗するテストを書く**
  - `hostView`:
    - 「`r:list` は `ranking` で、全員が順位の昇順に入る（`entries[i].rank` が `1, 1, 3, 4`）。`playerId` と `score` を含む」
    - 「`ranking_detail` は選んだ人の `rank` / `nickname` / `score` と `rankShown` / `nameShown` を含む」
    - 「参加者ゼロなら `entries` は空配列」
  - `screenView`（ネタバレの観点）:
    - 「`r:list` は `results_wait`」「選んだだけで何も投影していない（`:hidden`）も `results_wait`。JSON に選んだ人のニックネームと順位が含まれない」
    - 「`:rank` は `{ kind: "rank_reveal", rank, nickname: null }`。JSON に選んだ人のニックネームが含まれない」
    - 「`:name` は `{ rank: null, nickname }`。JSON にその人の順位が現れない（`"rank":null`）」
    - 「`:both` は両方入る」
    - 「同順位の 2 人のうち一方を投影しても、もう一方のニックネームは JSON に含まれない」
  - `guestView`: 「`results` のとき、選択状態にかかわらず `results_pending` で、JSON に他人のニックネームが入らない」（計画 3 のテストが通り続けること）
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/game/views.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装** — `results` の分岐を新しい形に置き換える。`rankPlayers(s)` は 1 回だけ呼ぶ。
- [ ] **Step 4: 実行して成功を確認** — `pnpm exec vitest run test/game`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 結果発表の幹事用・投影用ビューを作り直す`

---

### Task 4: Durable Object で受けて配る

**Files:**
- Modify: `apps/live/src/worker/session-room.ts`
- Test: `apps/live/test/worker/socket.test.ts`, `apps/live/test/worker/api.test.ts`, `apps/live/test/worker/load.test.ts`

**Interfaces:**
- Consumes: `presentResults`（Task 1）、`hostView` / `screenView`（Task 3）。
- Produces:
  - `webSocketMessage` の switch に `case "results_action"`: `att.role === "host"` のときだけ `this.apply(presentResults(this.state, msg.from, msg.action))`。
  - `deliver()` の送り先に 1 行足す（コメントの表も更新）:

    | イベント | 幹事 | 投影画面 | 参列者 |
    |---|---|---|---|
    | `projection_changed` | `host_view` | `screen_view` | なし |

  - `RankingResult.final` の意味: 「結果発表の段階に入った（全問の採点が確定した）」＝ `phase.type === "results"`。`ranking()` は `isFinal` を使わず、`final: s.phase.type === "results"` にする。`players`（順位つき全員）は今のまま。

- [ ] **Step 1: 失敗するテストを書く**（`socket.test.ts`。`connectHost` / `connectScreen` / `connectGuest` と、全問を `advance` で進める補助 `driveToResults(host, sessionId)` を `helpers.ts` に作る）
  - 「結果フェーズに入ると、幹事に `ranking`、投影画面に `results_wait`、参列者に `results_pending` が届く」
  - 「幹事が `select` すると、幹事に `ranking_detail`、投影画面に（`:hidden` の）`results_wait` が届き、**参列者には何も届かない**（参列者の `messages.length` が変わらない）」
  - 「`show_rank` で投影画面に `rank_reveal`（`rank` あり、`nickname: null`）、続けて `show_name` で両方入る」
  - 「`back` で投影画面は `results_wait` に戻り、幹事は `ranking` になる」
  - 「同じ `from` の `select` を 2 回送っても、状態は 1 回ぶんだけ変わる（`ranking` API の `phaseKey` が `r:<id>:hidden` のまま、幹事に届く `ranking_detail` は 1 通）」
  - 「別の幹事タブ 2 つが同じ `from: "r:list"` から別々の人を `select` すると、片方の人だけが選ばれる」
  - 「投影画面・参列者が送った `results_action` は無視される」
  - 「`results` 以外（`q:0:open`）での `results_action` は無視される。`PhaseKey` は変わらない」
  - 「存在しない `playerId` の `select` で幹事に何も届かず、接続も閉じない」
  - 「再読み込み: `select` + `show_rank` のあと、幹事・投影画面を接続し直すと、それぞれ `ranking_detail`（`rankShown: true`）と `rank_reveal` が届く」「DO を作り直しても同じ」（`state survives re-creating the Durable Object` と同じやり方）
  - `api.test.ts`: 「`/ranking` の `final` は、`results` に入ってから `true`（問題の途中は `false`）。`phaseKey` は `r:list` で、`players` は順位つき全員」
  - `load.test.ts`: 150 ゲストで最後まで進めたあと、`select` / `show_rank` を送っても**ゲストの受信数が増えない**ことを確認する（`driveQuiz` は `r:` に入ったところで止まるので、その直後に 1 回ずつ送って、数百 ms 待ち、各ゲストの受信数を比べる）。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run --config vitest.workers.config.ts test/worker`。Expected: FAIL。
- [ ] **Step 3: 実装** — 上のとおり。`deliver()` の中で `projection_changed` のときは `hosts` と `screens` だけを立てる。
- [ ] **Step 4: 全体を確認** — `pnpm test && pnpm typecheck`。Expected: PASS（Task 1〜3 で残った旧型の参照がここですべて消えること）。
- [ ] **Step 5: Commit** — `feat(live): 結果の操作を幹事から受け、幹事と投影画面だけに配る`

---

### Task 5: 幹事画面と投影画面のクライアント

**Files:**
- Create: `apps/live/src/client/host/ResultsPanel.tsx`（一覧）, `apps/live/src/client/host/RankDetailPanel.tsx`, `apps/live/src/client/screen/screens/RankRevealScreen.tsx`, `apps/live/src/client/screen/screens/ResultsWaitScreen.tsx`
- Modify: `apps/live/src/client/host/HostPanel.tsx`, `apps/live/src/client/host/host-action.ts`, `apps/live/src/client/host/useHostSession.ts`, `apps/live/src/client/host/HostApp.tsx`, `apps/live/src/client/screen/ScreenContent.tsx`, `apps/live/src/client/styles.css`
- Delete: `apps/live/src/client/screen/FittedList.tsx`, `apps/live/src/client/screen/useFitToBox.ts`, `apps/live/src/client/screen/screens/PodiumScreen.tsx`、`host-action.ts` の `listHeader`
- Test: `apps/live/test/client/host-action.test.ts`

**Interfaces:**
- Consumes: `HostView`（`ranking` / `ranking_detail`）、`ScreenView`（`results_wait` / `rank_reveal`）、`ResultsAction`、`ClientMessage`。
- Produces:
  - `resultsActionMessage(phaseKey: PhaseKey, action: ResultsAction): ClientMessage` — `{ type: "results_action", from: phaseKey, action }`（純関数。`host-action.ts`）。
  - `hostActionLabel(view)` は結果の 2 種類で `null` を返す（進行ボタンは出さない。結果の操作は専用のボタン）。
  - `useHostSession` が `sendResultsAction(action: ResultsAction): void` を返す。`view.phaseKey` を `from` に付けて送る。**結果の操作には `AdvanceGate` の冷却時間・ロックをかけない**（二度押しの重複は `from` の不一致でサーバーが落とすので、順位 → 名前と続けて押す操作を遅らせない）。切断中（`!connected`）は送らない。
  - `ResultsPanel({ entries, onSelect })` — 全員のニックネームと順位を並べ、行を押すと `onSelect(playerId)`。120 人でも幹事の端末でスクロールして使える（固定の高さで切らない）。`RankDetailPanel({ detail, onAction })` — 順位・名前・点数、「順位を投影」「名前を投影」（投影済みなら押せず `済` を表示）、「戻る」。どちらも分岐を持つので 1 ファイル 1 コンポーネント。
  - `RankRevealScreen({ screen })` — `rank` があれば大きく「`N 位`」、`nickname` があれば大きく名前を出す（片方だけの間は片方だけ）。`ResultsWaitScreen({ title })` — 「結果発表」と開催回名。

- [ ] **Step 1: 失敗するテストを書く**（`host-action.test.ts`）
  - 「`resultsActionMessage("r:list", { kind: "select", playerId: "p1" })` が `{ type: "results_action", from: "r:list", action: { kind: "select", playerId: "p1" } }`」
  - 「`hostActionLabel` が `ranking` / `ranking_detail` で `null`」（`list` / `podium` のテストは削除）
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client/host-action.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装** — 上のとおり。`HostPanel` の `switch` に `ranking` → `ResultsPanel`、`ranking_detail` → `RankDetailPanel` を足す。`ScreenContent` の `switch` に `results_wait` / `rank_reveal` を足す。
- [ ] **Step 4: 全体を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: 目視確認** — `pnpm dev` と `pnpm seed http://localhost:5173` で、ゲスト 5 人以上（同点が出るように回答を揃える）、幹事、投影画面を開き、最後の問題の後に「一覧 → 好きな人を選ぶ → 順位 → 名前 → 戻る → 別の人」の流れが、順番を変えても（3 位より先に 1 位、名前を先に投影）動くことを確認する。投影画面は、選んだだけでは何も出ないこと。参列者の画面が動かないこと。
- [ ] **Step 6: ドキュメントの更新** — `apps/live/README.md` と `CLAUDE.md` の「`r:list` → `r:<rank>:<hidden|shown>`」「3 位・2 位・1 位を順にめくる」の記述、`PhaseKey` の説明（結果フェーズの形）、`deliver()` の説明を更新する。設計書の 8 章「決定済み」にあった「作り直しになる」の注記は、実装後に本文へ移す（別途）。
- [ ] **Step 7: Commit** — `feat(live): 順位を好きな順に投影する幹事・投影画面`

---

## ユーザーに確認すること

1. **「戻る」を押したとき、投影画面は何を映すか**（既定は A）
   - **A. 待ち画面（「結果発表」）に戻す（推奨）**: 次の人を選んでいる間に、前の人の順位や名前が会場に残らない。
   - B. 直前に投影した内容をそのまま残す。次の人を選ぶ間も会場に映ったままで、操作の様子が見えにくい代わりに画面が空かない。
2. **一度投影した順位・名前を、あとから隠す操作は要るか**（既定は不要）。要るなら `ResultsAction` に `hide_rank` / `hide_name` を足し、キーの遷移を戻せる形にする（作業量 +1 時間程度）。「戻る」で一覧に戻れば投影画面は待ち画面になるため、MVP では不要と判断している。
3. **幹事の順位一覧に点数（正解数）も出すか**（既定は出す）。要件は「ニックネームと順位」。同点の確認や、会場でのじゃんけんで決着をつけるときの判断に役立つので推奨。
4. **`GET /api/sessions/:id/ranking` の `final`**: 「結果発表の段階に入ったら `true`」に変える（既定）。旧仕様は「1 位をめくったら `true`」だったが、発表の順番を決めなくなったので「終わり」を判定できない。Rails の結果保存は `final` が `true` の `players` を保存する想定（`apps/admin` は未着手）。結果発表の途中で保存してもよいか、別に「終了」操作が要るか。
5. **投影する順位の見せ方**: `N 位` だけ（既定）か、点数も出すか。要件は「順位」と「名前」。

## 作業量の見積もり

約 5〜7 時間（計画 1・3 の後）。Task 1: 1.5 時間、Task 2: 30 分、Task 3: 1 時間、Task 4: 1.5〜2 時間（Workers テスト、`deliver()`）、Task 5: 1.5〜2 時間（画面 4 つと目視確認、文書）。MVP 期限が 11/8 なので、時間が足りない場合は Task 5 の見た目の作り込みを後回しにして、ボタンが動く最小の見た目で先に通す。
