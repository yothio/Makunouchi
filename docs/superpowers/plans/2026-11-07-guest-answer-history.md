# 参列者の待機画面に回答一覧を出す Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参列者の待機画面に、これまでの問題ごとに自分が選んだ選択肢と正解・不正解の一覧（例: 問 1 B ○、問 2 C ×）を出す。正誤はその問題の正解発表のあとに出す。自分の順位は出さない。

**Architecture:** サーバー（`guestView`）が、正解発表を終えた問題だけの `history` を作って `GuestView` に載せる。クライアントは受け取った `history` を描画するだけで、正誤の判定はしない（正解の選択肢を先に漏らさないため）。結果発表の段階の `final`（順位つき）は廃止し、参列者には順位を送らない。

**Tech Stack:** TypeScript, Vitest（Node 環境 `test/game` `test/client`、Workers 環境 `test/worker`）, React 19

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`（4.3）、`docs/requirements/UI作成.md`（参列者画面 / 待機画面）、スケッチ b6

## 実施順と依存関係（4 本共通）

| 順 | 計画 | 内容 | 主に触る共通ファイル |
|---|---|---|---|
| 0 | `2026-11-07-remove-points-and-topn.md` | points / topN の削除 | `shared/types.ts`（`QuizQuestion` / `QuizPayload`）、`payload.ts`、`scoring.ts`、`ranking.ts` |
| 1 | `2026-11-07-split-host-and-screen.md` | 幹事画面と投影画面を分ける | `shared/types.ts`（`ScreenView`）、`role.ts`、`auth.ts`、`index.ts`、`session-room.ts` の `deliver()`、`views.ts`（`screenView`） |
| **3（この計画）** | `2026-11-07-guest-answer-history.md` | 参列者の待機画面に回答一覧 | `shared/types.ts`（`GuestView`）、`views.ts`（`guestView`） |
| 2 | `2026-11-07-free-order-results.md` | 順位を好きな順に投影する | `shared/types.ts`（`Phase` / `HostView` / `ScreenView` / `ClientMessage`）、`state.ts`、`ranking.ts`、`rules.ts`、`session-room.ts` の `deliver()` |

実施順は **0 → 1 → 3 → 2**。Draft PR は `gh stack` で積む。

この計画を 3 番目（計画 2 の前）にする理由:
- この計画は `GuestView` と `guestView()` だけを変え、`deliver()` や `Phase` は触らない。計画 1 とは独立しているので、順序は 1 の前でも動くが、`types.ts` / `views.ts` の同じファイルを連続して触るため積み順を揃える。
- 計画 2 は結果発表の段階（`ResultsStage`）を作り直す。今の `guestView` の `results` 分岐は `isFinal(phase, ranked)` と順位を使っているため、**先にこの計画で `guestView` を結果の段階から切り離しておく**（`results` なら常に `results_pending`、順位を送らない）。そうすると、計画 2 は `isFinal` / `nextPodiumRank` などを消しても `guestView` に触れずに済む。
- `RankingResult.final`（Rails 向けの `/api/sessions/:id/ranking`）は `isFinal` を使っているが、この計画では変えない（計画 2 で扱う）。

## Global Constraints

- 一覧は「これまでの問題ごとに、自分が選んだ選択肢と正解・不正解」。例: `問 1 B ○`、`問 2 C ×`。（設計書 4.3 の 2）
- **正誤は、その問題の正解発表のあとに出す。** 出題中・締め切り後（`q:<i>:open` / `q:<i>:closed`）の現在の問題は一覧に含めない。（`correctIndex` を漏らさない）
- 自分の順位は出さない。
- 途中参加者: 参加前の問題は 0 点のまま（`0 点` は既存の仕様）。一覧では未回答として出す。
- 回答しなかった問題も、正解発表のあとに「未回答 ×」として一覧に出る。
- 点数は正解数（計画 0）。画面に点数を出す既存の箇所（`reveal` の `score`）は残す。
- `PhaseKey` のエンコーディングは変えない。
- 参列者の画面は `guest_view` 1 種類で受け取る（クライアントに状態を持たせない）。
- 負荷: `guest_view` は全員に一斉送信される。`history` は最大 15 件の小さな配列なので増加は許容するが、他人のデータは含めない。
- 範囲を広げない（MVP 期限 11/8）。

## Review Focus

1. **正解の先出し**: 現在の問題が `open` / `closed` の間、`history` に現在の問題が入らない。`guest_view` の JSON に、現在の問題の `correct` が出ない。→ Task 1。
2. **他人の情報**: `history` に他の参列者の回答・ニックネームが入らない。→ Task 1。
3. **順位の漏えい**: 結果発表の段階の `guest_view` に `rank` が含まれない。→ Task 1。
4. **再接続・途中参加**: 端末を開き直しても、同じ一覧が復元される。途中参加の人は参加前の問題が「未回答 ×」になる。→ Task 1・Task 2。
5. **未回答**: 回答しなかった問題は `choice: null`・`correct: false`。選択肢の表示が壊れない（`null` のとき「未回答」）。→ Task 1・Task 3。
6. **問題数が多い場合**: 15 問のとき、一覧がスマホの画面に収まる（スクロールできる）。→ Task 3 の目視。

---

## ファイル構成

```
apps/live/
  src/shared/types.ts               # HistoryEntry 追加、GuestView に history、final を削除
  src/worker/game/views.ts          # answerHistory()、guestView を更新
  src/client/guest/history.ts       # formatHistoryEntry()（純関数）
  src/client/guest/AnswerHistory.tsx
  src/client/guest/GuestScreen.tsx  # 待機系の画面に AnswerHistory を出す
  src/client/guest/views/QuestionClosed.tsx
  src/client/styles.css
  src/loadtest/drive.ts             # results_pending を見る箇所はそのまま（確認のみ）
  test/game/views.test.ts, test/worker/socket.test.ts, test/client/guest-history.test.ts
```

---

### Task 1: サーバーが `history` を作り、順位を送らない

**Files:**
- Modify: `apps/live/src/shared/types.ts`, `apps/live/src/worker/game/views.ts`, `apps/live/src/worker/session-room.ts`
- Modify（typecheck を通すための最小変更）: `apps/live/src/client/guest/GuestScreen.tsx` — `case "final":` の分岐だけを削除する（`GuestView` から `final` が消えるため、残すと `switch (view.kind)` が型エラーになる）。`history` を画面に出す作業は Task 3 まで行わない。
- Test: `apps/live/test/game/views.test.ts`（`GuestView` のリテラルを作っている他のテスト、`test/client/*.test.ts` なども `history` / `final` の変更に合わせて直す）

**Interfaces:**
- Produces（`shared/types.ts`）:
  ```ts
  /** 正解発表を終えた問題 1 つぶんの、本人の回答。 */
  export type HistoryEntry = { index: number; choice: Choice | null; correct: boolean };

  export type GuestView =
    | { kind: "lobby"; title: string; nickname: string }
    | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; myChoice: Choice | null; history: HistoryEntry[] }
    | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; myChoice: Choice | null; correct: boolean; score: number; history: HistoryEntry[] }
    | { kind: "results_pending"; nickname: string; history: HistoryEntry[] };
  // `final` は削除する。
  ```
- Produces（`views.ts`）: `answerHistory(s: GameState, player: Player): HistoryEntry[]`（内部関数）— 正解発表を終えた問題、つまり `phase.type === "question"` なら `index < phase.index` と、`status === "revealed"` のときの `index === phase.index`、`results` なら全問。`lobby` は空。`index` 昇順。`correct` は `choice === correctIndex`（未回答は `false`）。`scoreOf` の「採点済みの範囲」と同じ範囲なので、`scoreOf` と範囲の計算を共通の関数にしてよい（`scoring.ts` に `revealedCount(s): number` を出す）。
- `guestView(s, playerId, ranked?)` の `ranked` 引数は不要になるので削除し、`deliver()` の呼び出し（`session-room.ts`）から `ranked` の計算（`rankPlayers(s)` を results のときだけ 1 回）を取り除く。`rankPlayers` の import が `session-room.ts` で `ranking()` にまだ必要か確認する。

- [ ] **Step 1: 失敗するテストを書く**（`views.test.ts` の `describe("guestView")` と「answer leakage」）
  - 「`q:0:open` では `history` が空」「`q:0:closed` でも空で、JSON に `"correct"` が現れない」
  - 「`q:0:revealed` では `history` が 1 件: 正解を選んだ人は `{ index: 0, choice: 1, correct: true }`、誤答は `correct: false`、未回答は `{ index: 0, choice: null, correct: false }`」
  - 「`q:1:open` では `history` が問 0 のぶんだけ（現在の問題は含まない）」
  - 「`results` では全問ぶんが `index` 昇順で入る」
  - 「途中参加（問 2 の途中で参加）の人は、問 0・問 1 が `choice: null, correct: false` で入る」
  - 「`history` に他人の `choice` やニックネームが入らない」: 2 人で別々の回答をして、片方の `guestView` の JSON に他方のニックネームが含まれない。
  - 「`results` の `guestView` は `kind: "results_pending"` で、JSON に `"rank"` が含まれない」（1 位を発表し終えた状態に相当する `results` でも）
  - 既存の「最終発表の途中は `results_pending`、1 位をめくった後は `final`」のテストは、「`results` ならいつでも `results_pending`」に書き換える。
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run test/game/views.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装** — 型を直し、`guestView` の各分岐に `history: answerHistory(s, player)` を足し、`results` は常に `results_pending` を返す。`session-room.ts` の `deliver()` から `ranked` を外す。`GuestScreen.tsx` の `case "final":` を削除する。未使用になった import（`views.ts` の `isFinal` / `RankedPlayer`、`session-room.ts` の `RankedPlayer` など。oxlint が警告する）を消す。
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS（この時点のゲスト画面は、`history` を受け取っても表示しないだけで動く）。`test/worker/socket.test.ts` や `load.test.ts` に `final` を前提にした箇所があれば同じ考え方で直す。
- [ ] **Step 5: Commit** — `feat(live): guest_view に回答一覧を足し、順位を送らない`

---

### Task 2: 再接続・途中参加で一覧が復元されることを結合テストで確認する

**Files:**
- Test: `apps/live/test/worker/socket.test.ts`

**Interfaces:**
- Consumes: `connectHost` / `connectGuest` / `createSession`（`test/worker/helpers.ts`）。コードの変更はなし。

- [ ] **Step 1: テストを書く**
  - 「正解発表（`q:0:revealed`）のあと、参列者の `guest_view`（`reveal`）の `history` に問 0 が入る」
  - 「保存済みの `playerToken` で再接続すると、`history` つきの `guest_view` が復元される」（`reconnect with saved token restores nickname and score` の隣に置く）
  - 「問 1 を `open` にしたあとの参列者の `guest_view`（`question`）の `history` は問 0 のみ」
  - 「途中参加した人の `reveal` では、参加前の問題が `choice: null`」
- [ ] **Step 2: 実行する** — `pnpm exec vitest run --config vitest.workers.config.ts test/worker/socket.test.ts`。Expected: PASS。このタスクは Task 1 の実装を結合テストで確かめるもので、red は Task 1 の単体テストで確認済み。落ちるなら Task 1 の穴。
- [ ] **Step 3: 負荷試験の確認** — `pnpm exec vitest run --config vitest.workers.config.ts test/worker/load.test.ts`。Expected: PASS（`src/loadtest/drive.ts` は `results_pending` を見ているので変更不要。落ちたら `final` の参照が残っていないか確認）。
- [ ] **Step 4: Commit** — `test(live): 回答一覧の再接続・途中参加を確認`

---

### Task 3: 待機画面に一覧を出す

**Files:**
- Create: `apps/live/src/client/guest/history.ts`, `apps/live/src/client/guest/AnswerHistory.tsx`
- Modify: `apps/live/src/client/guest/GuestScreen.tsx`, `apps/live/src/client/guest/views/QuestionClosed.tsx`, `apps/live/src/client/styles.css`
- Test: `apps/live/test/client/guest-history.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`（Task 1）、`CHOICE_LABELS`（`src/client/choice-labels.ts`）。
- Produces:
  - `formatHistoryEntry(entry: HistoryEntry): { question: string; choice: string; mark: "○" | "×" }` — `question` は `問 ${index + 1}`、`choice` は選んだ選択肢のラベル（`A`〜`D`）、未回答は `"未回答"`、`mark` は `correct` なら `○`、そうでなければ `×`。
  - `AnswerHistory({ history }: { history: HistoryEntry[] })` — `history` が空なら何も出さない。1 行に `formatHistoryEntry` の結果を並べる。1 ファイル 1 コンポーネント（条件の分岐があるため）。
  - 差し込み箇所（コンポーネントごと）:
    - `question`（`status === "closed"`）: `views/QuestionView.tsx` → `views/QuestionClosed.tsx` の中で `<AnswerHistory history={...} />` を出す（`QuestionView` から `history` を渡す）。`open` の間は出さない（回答に集中させる）。
    - `reveal` と `results_pending`: `GuestScreen.tsx` の該当 `case` で出す。`results_pending` の見出しは今の「結果発表中…」のまま（順位は出さない）。
    - `lobby`: 履歴がないので出さない。
    - `final` 分岐の削除は Task 1 で済んでいる。

- [ ] **Step 1: 失敗するテストを書く**（`guest-history.test.ts`, Node 環境）
  - 「`{ index: 0, choice: 1, correct: true }` → `{ question: "問 1", choice: "B", mark: "○" }`」
  - 「`{ index: 1, choice: 2, correct: false }` → `{ question: "問 2", choice: "C", mark: "×" }`」
  - 「`{ index: 2, choice: null, correct: false }` → `choice: "未回答"`, `mark: "×"`」
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client/guest-history.test.ts`。Expected: FAIL（モジュールがない）。
- [ ] **Step 3: 実装** — 純関数、`AnswerHistory`、`GuestScreen` の変更、CSS（15 行でも画面に収まり、はみ出したらスクロールする）。
- [ ] **Step 4: 全体を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: 目視確認** — `pnpm dev` と `pnpm seed http://localhost:5173` で、ゲスト 2 人（1 人は 1 問飛ばす）と幹事を使い、締め切り後・正解発表後・結果発表中に一覧が出て、`open` の間は出ないこと、順位がどこにも出ないことを確認する。スマホ幅（375px）で 15 行が収まること。
- [ ] **Step 6: Commit** — `feat(live): 参列者の待機画面に回答一覧を表示`

---

## ユーザーに確認すること

### 決定済みの解釈（確認ではなく、前提として置いたもの）

- **参列者の画面には順位を一切出さない**。設計書 8 章「決定済み（2026-11-07）」に「参列者画面には各問の自分の回答と正誤を一覧で見せる。順位は見せない」とあるので、`final`（順位つき）を廃止する。順位は投影画面で発表する。
  - 将来案として残す余地: 「式の最後に自分の順位を手元で見せたい」となった場合は、「発表の終わり」をサーバーが知る仕組み（幹事の「終了」操作など）が別途要る。順位の発表順を幹事が自由に決める設計（計画 2）とは相性が悪いので、MVP の範囲には入れない。

### 確認すること

1. **途中参加者の参加前の問題**
   - **A. 「未回答 ×」と出す（推奨）**: 一覧の行数が全員そろい、「参加前の問題は 0 点」（設計書 4.3）と整合する。
   - B. 一覧に出さず、参加後の問題だけにする: 見た目はすっきりするが、人によって行数が違い、サーバー側で参加時点の問題番号を持つ必要がある（`Player` に `joinedAtIndex` を足す。作業量 +30 分程度）。
2. **正解発表の画面（`reveal`）に累計点（`score`）を残すか**
   - **A. 残す（推奨）**: 「点数は正解数」なので、一覧の ○ の数と一致する。順位ではないため要件に反しない。変更が増えない。
   - B. 外す: 一覧の ○ の数で分かるので画面は簡素になるが、`GuestView.reveal` の `score` を消す変更が増える。

## 作業量の見積もり

約 2〜3 時間。Task 1: 1〜1.5 時間（型とテストが中心）、Task 2: 30 分、Task 3: 1 時間（目視確認を含む）。
