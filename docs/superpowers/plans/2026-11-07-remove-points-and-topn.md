# 配点（points）と上位一覧の表示人数（topN）の削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クイズのペイロードから `points`（問題ごとの配点）と `topN`（4 位以下の一覧に出す人数）をなくし、点数を「正解した問題の数」にする。

**Architecture:** 採点（`scoring.ts`）と一覧の絞り込み（`ranking.ts` の `listEntries`）を先に `points` / `topN` へ依存しない形に直し、そのあとで型・zod スキーマ・フィクスチャから項目を消す。この順にすると、各タスクの終わりで typecheck が通る。

**Tech Stack:** TypeScript, zod, Vitest（Node 環境 `test/game`、Workers 環境 `test/worker`）

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`（4.4、8 章「決定済み（2026-11-07）」の「配点・上位一覧の表示人数（XX）は作らない。点数は正解数」）

## 実施順と依存関係（4 本共通）

| 順 | 計画 | 内容 | 主に触る共通ファイル |
|---|---|---|---|
| **0（この計画）** | `2026-11-07-remove-points-and-topn.md` | points / topN の削除 | `shared/types.ts`（`QuizQuestion` / `QuizPayload`）、`payload.ts`、`scoring.ts`、`ranking.ts`、`views.ts`（一覧の呼び出し 1 行） |
| 1 | `2026-11-07-split-host-and-screen.md` | 幹事画面と投影画面を分ける | `shared/types.ts`（`ScreenView` 追加）、`role.ts`、`auth.ts`、`index.ts`、`session-room.ts` の `deliver()`、`views.ts`（`screenView` 追加） |
| 3 | `2026-11-07-guest-answer-history.md` | 参列者の待機画面に回答一覧 | `shared/types.ts`（`GuestView`）、`views.ts`（`guestView`） |
| 2 | `2026-11-07-free-order-results.md` | 順位を好きな順に投影する | `shared/types.ts`（`Phase` / `HostView` / `ScreenView` / `ClientMessage`）、`state.ts`、`ranking.ts`、`rules.ts`、`session-room.ts` の `deliver()` |

番号は要件の項目番号で、**実施順は 0 → 1 → 3 → 2**。Draft PR は `gh stack` で上の順に積み、前の PR がマージされてから次をリベースする（同じファイルの別の箇所を触るため、並行して進めると `types.ts` / `views.ts` / `session-room.ts` で衝突する）。

この計画を最初にする理由:
- `points` / `topN` を使っているのは `scoring.ts` と `listEntries` だけで、他の 3 本が触る画面・通信とは独立している。
- `topN` を使う `listEntries` は計画 2 で削除されるが、計画 2 の中で `topN` まで同時に扱うと「配点の削除」と「発表の作り直し」が混ざってレビューしにくい。先に 1 つの小さい PR で片付ける。
- 計画 3 以降のテストが使う `quiz` フィクスチャ（`test/worker/helpers.ts`、`fixtures/sample-quiz.json`）が、最初から新しい形になる。

## Global Constraints

- 点数は、正解した問題の数。回答の速さは関係ない。
- 問題の項目は「タイトル・画像・選択肢 A〜D・正解」のみ。説明（幹事用メモ）・配点・並べ替え・上位一覧の表示人数は作らない。
- 同点は同じ順位（競技方式: 90, 90, 80 → 1, 1, 3 位）。
- 関数はすべて `const` のアロー関数（oxlint の `func-style`）。
- 問題数は 5〜15 問、1 問 4 択（現状の制約を変えない）。
- `PhaseKey`（`lobby` / `q:<i>:<open|closed|revealed>` / `r:...`）のエンコーディングは変えない。この計画は `PhaseKey` に触れない。
- 範囲を広げない（MVP 期限 11/8）。`apps/admin` は扱わない。

## Review Focus

1. **旧形式のペイロード**: `points` / `topN` を含む JSON が届いても 422 にしない。余計なキーは捨て、保存される `quiz` に残さない。→ Task 2 の `payload.test.ts`。
2. **点数の食い違い**: 配点が 10 や 30 の旧データでも、点数は正解数（1 問 1 点）になる。→ Task 1 の `scoreOf` テスト。
3. **同点の一覧**: `topN` で切らなくなると、4 位以下は全員が一覧に出る。同点で 1 位が複数いて 4 位が空になる場合も落ちない。→ Task 1 の `listEntries` テスト。
4. **取りこぼし**: テスト・スクリプト・フィクスチャ・README に `points` / `topN` が残ると typecheck か実行時に壊れる。→ Task 2 の最後の grep。
5. **未回答・途中参加**: 参加前の問題や未回答の問題は 0 点のまま（加点されない）。→ Task 1 の `scoreOf` テスト。

---

## ファイル構成

```
apps/live/
  src/shared/types.ts               # QuizQuestion から points、QuizPayload から topN を削除
  src/worker/payload.ts             # POINTS_* / TOP_N_MAX / LIST_FIRST_RANK の import を削除
  src/worker/game/scoring.ts        # total += 1
  src/worker/game/ranking.ts        # listEntries(ranked) — topN 引数を削除
  src/worker/game/views.ts          # listEntries の呼び出しを 1 引数に
  fixtures/sample-quiz.json         # points / topN を削除
  test/worker/helpers.ts            # quiz フィクスチャから points / topN を削除
  test/game/{state,ranking,views,payload}.test.ts
  （必要なら）src/loadtest/*、scripts/*、README.md の該当箇所
```

---

### Task 1: 採点と一覧を points / topN に依存させない

**Files:**
- Modify: `apps/live/src/worker/game/scoring.ts`, `apps/live/src/worker/game/ranking.ts`, `apps/live/src/worker/game/views.ts`
- Test: `apps/live/test/game/state.test.ts`（`scoreOf` の describe）、`apps/live/test/game/ranking.test.ts`、`apps/live/test/game/views.test.ts`

**Interfaces:**
- Produces:
  - `scoreOf(s: GameState, player: Player): number` — 署名は変えない。正解 1 問につき 1 点。
  - `listEntries(ranked: RankedPlayer[]): RankedPlayer[]` — `rank >= LIST_FIRST_RANK` の全員（`topN` 引数を削除）。

- [ ] **Step 1: 失敗するテストを書く**
  - `state.test.ts` の `scoreOf` 「配点 10 と 30」のテストを書き換える: 配点が異なる 2 問（`points` を `as never` で残した旧形式）で、2 問とも正解したら `scoreOf` が `2`。`closed` の問題は数えず、`revealed` になって初めて加算される既存の確認は残す。
  - 同じ describe に「未回答の問題と参加前の問題は 0 点」「`results` では全問採点」が正解数で成り立つテストを置く。
  - `ranking.test.ts` の「`listEntries` は 4 位〜topN 位」を書き換える: `listEntries(ranked)` が rank 4 以上の全員（`topN` で切られない）を返す。入力は 6 人（rank 1,2,3,4,5,6）で、戻り値の rank は `[4, 5, 6]`。
  - 同点で 1 位が 3 人（rank 1,1,1,4）のとき `listEntries` は rank 4 の 1 人だけを返す。
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run test/game/state.test.ts test/game/ranking.test.ts`。Expected: FAIL（配点で加算される、`listEntries` が引数 1 つでは `topN` 未定義で 0 件を返す）。
- [ ] **Step 3: 実装** — `scoring.ts` は `total += 1`（`q.points` を参照しない）。`ranking.ts` の `listEntries` から `topN` 引数を消す。`views.ts` の呼び出しを `listEntries(ranked)` にする。
- [ ] **Step 4: 実行して成功を確認** — `pnpm exec vitest run test/game`。Expected: PASS。`views.test.ts` に `topN` を前提にした期待値があれば、同じ考え方（4 位以下は全員）で直す。
- [ ] **Step 5: Commit** — `refactor(live): 点数を正解数にし、一覧を topN で絞らない`

---

### Task 2: 型・スキーマ・フィクスチャから points / topN を消す

**Files:**
- Modify: `apps/live/src/shared/types.ts`（`QuizQuestion.points`、`QuizPayload.topN`）、`apps/live/src/worker/payload.ts`、`apps/live/fixtures/sample-quiz.json`、`apps/live/test/worker/helpers.ts`
- Modify（grep で見つかったものだけ）: `apps/live/src/loadtest/*`、`apps/live/scripts/*`、`apps/live/README.md`
- Test: `apps/live/test/game/payload.test.ts`

**Interfaces:**
- Produces:
  - `QuizQuestion = { title; imageUrl; choices; correctIndex }`（`points` なし）
  - `QuizPayload = { title: string; questions: QuizQuestion[] }`（`topN` なし）
  - `quizPayloadSchema` — `points` / `topN` を定義しない。zod の既定どおり未知のキーは**捨てる**（`.strict()` にはしない）。

- [ ] **Step 1: 失敗するテストを書く**（`payload.test.ts`）
  - 「`points` と `topN` を含む旧形式のペイロードも受け付け、パース結果に `topN` と各問題の `points` が含まれない」: `expect(result.data).not.toHaveProperty("topN")`、`expect(result.data.questions[0]).not.toHaveProperty("points")`。
  - 「`points` / `topN` がなくても受け付ける」: 新形式がそのまま成功する。
  - 既存の `topN` 範囲（4 未満・101 以上）と `points` 範囲（0・1001）を検証していたテストは削除する。
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/game/payload.test.ts`。Expected: FAIL（`points` なしの入力が必須エラーになる）。
- [ ] **Step 3: 実装** — `types.ts` から 2 項目を削除。`payload.ts` から `TOP_N_MAX` / `POINTS_MIN` / `POINTS_MAX` / `LIST_FIRST_RANK` の import と `points` / `topN` のフィールドを削除。`fixtures/sample-quiz.json` と `test/worker/helpers.ts` の `quiz` から 2 項目を削除。
- [ ] **Step 4: 取りこぼしを探す** — `cd apps/live && grep -rn "topN\|points" src test scripts fixtures README.md`。残りがゼロ（コメント内の「points」という英単語を除く）になるまで直す。`docs/superpowers/plans/2026-10-26-live-quiz-cloudflare.md` は当時の記録なので直さない。
- [ ] **Step 5: 全体を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: すべて PASS。
- [ ] **Step 6: Commit** — `refactor(live): ペイロードから points と topN を削除`

---

## 決定事項（2026-11-07、ユーザー判断）

- **実施範囲（案 A）**: 11/8 の MVP 期限までに実装するのは `remove-points-and-topn`、`split-host-and-screen`、`guest-answer-history` の 3 本（この順）。`free-order-results` は期限後に回す。
- **確認事項 1 → A**: 旧形式（`points` / `topN` 付き）のペイロードは受け付けて無視する（`.strict()` にしない）。

## ユーザーに確認すること（決定済み）

1. **旧形式（`points` / `topN` 付き）のペイロードを受け付けるか** — **決定: A**
   - A. 受け付けて無視する（この計画の既定・推奨）。Rails 側が項目を落とすまで、送る側を同時に直さなくてよい。
   - B. `.strict()` で 422 にする。送る側の直し忘れに気づけるが、`apps/admin` ができるまで送り手は `seed` スクリプトだけなので得るものが少ない。

## 作業量の見積もり

約 1〜2 時間（Task 1: 30〜45 分、Task 2: 30〜60 分）。テストの書き換えが中心で、実装は数行。
