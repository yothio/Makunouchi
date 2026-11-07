# 投影画面の結果一覧のページ送り（追補）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 投影画面の結果一覧（4 位以下）を 1 ページ 40 人までに分け、幹事のボタンでページを送る。どのページも、スクロールも見切れもなく、20px 以上の文字で読めるようにする。

**Architecture:** 結果フェーズの `list` 段階に「何ページ目か」を持たせる。ページ送りは既存の `advance`（幹事の進行ボタン）で行い、冪等性は `PhaseKey` にページ番号を含めることで保つ。投影画面の文字の大きさと列数は、箱の大きさと人数から**計算**で決める（DOM を何百回も測らない）。名前は 1 行で省略し、行の高さを一定にする。

**Tech Stack:** TypeScript, React 19, Vitest（Node 環境 `test/game` `test/client`、Workers 環境 `test/worker`）

**Spec:** `docs/superpowers/specs/2026-10-25-wedding-quiz-design.md`（4.2、投影画面は操作しない）。経緯: `7fe50aa`（最大 8 列にする修正）のレビュー（必須 2 件、推奨 3 件）で、列を増やすだけでは 1280×720 などで 12px 前後まで落ちることが分かり、ユーザーが**ページ送り（B 案）**を決めた。

## 位置づけ

- 結果発表の作り直し（`2026-11-07-free-order-results.md`）は期限後。それまでは今の「一覧 → 3・2・1 位」が本番の結果発表になるので、一覧だけをこの計画でページ分割する。
- 計画 2 を実装するときは、この計画の `list` 段階（`page`）と `r:list:<page>` は計画 2 の `r:list` / `r:<playerId>:*` に置き換わる。投影画面の一覧が不要になるので、ページ分割の部分は捨ててよい。ただし**文字の大きさと列数を計算で決める純関数（Task 2）は、幹事の画面の順位一覧などで再利用できる**。
- 問題フェーズの `PhaseKey`（`lobby`、`q:<i>:<open|closed|revealed>`）は変えない。

## Global Constraints

- 投影画面は操作しない。ページ送りは幹事画面の進行ボタン（既存の `advance`）で行う。投影画面にスクロールや自動切り替えは持たせない（自動切り替えは、読み終える前に切り替わる・幹事が把握できない、という問題があるため採らない）。
- 文字の大きさは **20px 以上**。対象の画面サイズ: 1920×1080、1366×768、1280×720。
- 1 ページの上限は **40 人**（下の根拠）。
- 参加人数は最大 120 人程度。一覧は 4 位以下なので、最大約 117 行（3 ページ）。
- 同順位は同じページに揃えない（ページは「順位順 40 行ずつ」で切る。同点の人がページをまたいでもよい。順位は各行に出ているので読み違えない）。
- 長いニックネーム（最大 20 文字）は、1 行で省略する（`text-overflow: ellipsis`）。折り返さないので行の高さは一定。
- 関数は `const` のアロー関数。分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネント。JSX は `return` の中だけ。ロジックは純関数かカスタムフックに出す。（`CLAUDE.md`）
- 範囲を広げない。`apps/admin`、幹事ログイン方式は扱わない。

## 決定: 1 ページの人数 = 40

`styles.css` の寸法から手計算した（実機での確認は Task 5）。前提: 一覧の箱は高さ 66vh、幅 90vw、列間 1.2vw。1 行の高さは `1.6em`（line-height 1.3 + 上下 padding 0.3）、行間 `0.2em`。1 行の固定幅（順位 3em + 点数 約 3.4em + gap / padding 約 2em）は約 `8.4em`、名前には最低 `4em` を確保する。列は最大 4。

| 画面 | 箱（幅×高さ） | 40 人のとき | 判断 |
|---|---|---|---|
| 1920×1080 | 1728×713 | 4 列・10 行で約 33px | 20px を大きく上回る |
| 1366×768 | 1229×507 | 4 列・10 行で約 23px | 余裕あり |
| 1280×720 | 1152×475 | 4 列・10 行で約 22px | 20px を 2px 上回る。**これが 40 の上限を決める** |

45 人にすると 1280×720 でちょうど 20px（余裕がない）、50 人では 5 列が要り名前の幅が足りない。したがって **40 人**（20px に対して 2px の余裕が残る最大のきりのよい数）とする。実機で 20px を割る画面があれば、`LIST_PAGE_SIZE` を 36 などに下げる（定数 1 つ）。

## `PhaseKey` と冪等性

- `ResultsStage` の `list` を `{ kind: "list"; page: number }`（0 始まり）にする。
- 結果フェーズの `PhaseKey`: 一覧は **`r:list:<page>`**（例: `r:list:0`、`r:list:1`）。表彰台は今のまま `r:<rank>:<hidden|shown>`。問題フェーズは変えない。
- ページ送りは `advance(from)` のまま。`from` が現在の `PhaseKey`（`r:list:<page>`）と一致したときだけ次へ進む。ページを送るとキーが変わるので、**二度押し・再送・2 つのタブからの同時操作では 2 回目が `stale_phase` になって捨てられる**（問題フェーズの `advance` と同じ冪等性）。既存の `AdvanceGate`（冷却 1 秒・ロック）もそのまま効く。
- 遷移: 最後の問題の `revealed` → `r:list:0`。`r:list:p` → 次のページがあれば `r:list:<p+1>`、なければ今の「最初の表彰台（伏せ）」。人数が 0〜3 人で一覧が空のときも `r:list:0` を 1 ページとして出す（「4 位以下はいません」）。
- 保存済みの旧形式（`stage: { kind: "list" }` に `page` がない状態）の開催回はデプロイ後に作り直す（既存の運用方針と同じ。旧状態は読み替えない）。

## 幹事画面のボタン文言

- 一覧の途中のページ: **`次のページへ（<現在+2>/<全ページ数>）`**（例: 1 ページ目で `次のページへ（2/3）`）。
- 一覧の最後のページ: 今のまま（`3 位を発表`。表彰台がなければボタンなし）。
- 幹事画面の一覧のパネルには `ページ <現在+1> / <全ページ数>` と、そのページの人を表示する。
- 投影画面の一覧の見出しは今のまま（`16 位〜55 位` のように、そのページの順位の範囲）に、全ページ数が 2 以上のとき `（1/3）` を添える。

## Review Focus

1. **見切れ・スクロールがない**: 1920×1080、1366×768、1280×720 の 3 サイズで、20 文字のニックネームを混ぜた 120 人の全ページ。→ Task 5（実機）、Task 2（性質のテスト）。
2. **文字が 20px 以上**: 上の 3 サイズで、40 人のページが 20px 以上で収まる。→ Task 2。
3. **人数が変わっても見た目が飛ばない**: 人数が増えたとき、文字は小さくなる一方で大きくならず、列数は減らない（急に 1 列から 4 列に飛ぶのは、段階的に増えるのでよい）。中人数（15〜40 人）で列数が行ったり来たりしない。→ Task 2。
4. **二度押し**: ページ送りを同じ `from` で 2 回送っても 1 ページだけ進む。→ Task 1。
5. **ページが多すぎても落ちない**: 4 位以下が 0 人・1 人・40 人（ちょうど 1 ページ）・41 人（2 ページ）・117 人。→ Task 1。
6. **長いニックネーム**: 20 文字は 1 行で省略され、行が高くならない（折り返さない）。→ Task 3、Task 5。
7. **再読み込み**: 投影画面・幹事画面を開き直すと、同じページに戻る（サーバーが状態を持つ）。→ Task 4。

---

## ファイル構成

```
apps/live/
  src/shared/types.ts               # ResultsStage の list に page、HostView / ScreenView の list に page と pageCount
  src/worker/game/rules.ts          # LIST_PAGE_SIZE = 40
  src/worker/game/ranking.ts        # listPageCount()、listPageEntries()、isFinal の更新
  src/worker/game/state.ts          # phaseKey()、nextPhase() の list 段階
  src/worker/game/views.ts          # hostView / screenView の list
  src/client/screen/list-layout.ts  # chooseListLayout()（純関数）
  src/client/screen/useFitToBox.ts  # 計算結果を DOM に適用するだけにする
  src/client/screen/FittedList.tsx, list-header.ts, ScreenContent.tsx
  src/client/host/host-action.ts, HostPanel.tsx
  src/client/styles.css             # 名前を 1 行で省略、行の高さを一定に
  test/game/{state,ranking,views}.test.ts, test/client/{list-layout,host-action}.test.ts, test/worker/socket.test.ts
```

---

### Task 1: サーバー側のページ（状態・`PhaseKey`・ビュー）

**Files:**
- Modify: `apps/live/src/shared/types.ts`, `apps/live/src/worker/game/rules.ts`, `apps/live/src/worker/game/ranking.ts`, `apps/live/src/worker/game/state.ts`, `apps/live/src/worker/game/views.ts`
- Test: `apps/live/test/game/state.test.ts`, `apps/live/test/game/ranking.test.ts`, `apps/live/test/game/views.test.ts`、およびこれらのテストで `{ kind: "list" }` を作っている箇所

**Interfaces:**
- Produces:
  - `rules.ts`: `LIST_PAGE_SIZE = 40`
  - `types.ts`: `ResultsStage = { kind: "list"; page: number } | { kind: "podium"; ... }`。`HostView` の `list` は `{ kind: "list"; entries; nextRank; page: number; pageCount: number }`。`ScreenView` の `list` は `{ kind: "list"; entries; page: number; pageCount: number }`（`entries` は**そのページの行だけ**）。
  - `ranking.ts`: `listPageCount(ranked: RankedPlayer[]): number`（`max(1, ceil(一覧の人数 / LIST_PAGE_SIZE))`）、`listPageEntries(ranked: RankedPlayer[], page: number): RankedPlayer[]`（4 位以下を順位順に並べた `LIST_PAGE_SIZE` 行）。`isFinal`: 一覧は「最後のページで、表彰台に人がいない」ときだけ `true`。
  - `state.ts`: `phaseKey` は一覧で `r:list:<page>`。`nextPhase` の `list` は、次のページがあれば `page + 1`、なければ今の表彰台の最初。
- `advance` のシグネチャは変えない。

- [ ] **Step 1: 失敗するテストを書く**
  - `state.test.ts`:
    - 「最後の問題の `revealed` から `advance` すると `r:list:0`」
    - 「`phaseKey`: `r:list:0`、`r:list:2`。問題フェーズのキー（`lobby`、`q:0:open`、`q:3:closed`、`q:14:revealed`）は変わらない」
    - 「一覧が 41 人（4 位以下が 41 人）なら、`r:list:0` → `r:list:1` → 表彰台（伏せ）の順に進む」「ちょうど 40 人なら `r:list:0` から直接表彰台」
    - 「同じ `from`（`r:list:0`）で 2 回 `advance` しても、2 回目は `stale_phase` で状態は 1 ページぶんしか進まない」
    - 「古いキー `r:list:0` を `r:list:1` の状態に送ると `stale_phase`」
    - 「4 位以下が 0 人でも `r:list:0` を 1 ページとして出し、表彰台があればそこへ進む」
    - 既存の表彰台の進行テスト（`r:3:hidden` など）は一覧のキーだけ書き換えて残す。
  - `ranking.test.ts`: 「`listPageCount`: 0 人・1 人・40 人・41 人・117 人で 1・1・1・2・3」「`listPageEntries`: ページごとに 40 行、最後は端数、順位の昇順、ページをまたいでも重複・欠落がない」「`isFinal`: 一覧の最後のページかつ表彰台なしで `true`、途中のページは `false`」
  - `views.test.ts`: 「`hostView` / `screenView` の `list` に `page` / `pageCount` が入り、`entries` はそのページの行だけ」「範囲外のページ番号でも例外を投げず空の `entries`」
- [ ] **Step 2: 実行して失敗を確認** — `cd apps/live && pnpm exec vitest run test/game`。Expected: FAIL。
- [ ] **Step 3: 実装** — 上のとおり。
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 結果一覧をページに分け、ページ送りを advance で行う`

---

### Task 2: 文字の大きさと列数を計算する純関数

**Files:**
- Create: `apps/live/src/client/screen/list-layout.ts`
- Test: `apps/live/test/client/list-layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ListBox = { width: number; height: number };          // 一覧の箱の大きさ（px）
  export type ListLayout = { px: number; cols: number; rows: number };
  export const LIST_MIN_PX = 20;
  export const LIST_MAX_PX = 40;
  export const LIST_MAX_COLS = 4;
  /** 行の寸法はすべて em。styles.css の .host-list-grid と同じ値にする。 */
  export const ROW_HEIGHT_EM = 1.6;
  export const ROW_GAP_EM = 0.2;
  export const ROW_FIXED_WIDTH_EM = 8.4;   // 順位 + 点数 + gap / padding
  export const NAME_MIN_WIDTH_EM = 4;
  export const chooseListLayout: (count: number, box: ListBox, colGapPx: number) => ListLayout | null;
  ```
  `chooseListLayout` は、`LIST_MAX_PX` から `LIST_MIN_PX` まで 1px ずつ、各フォントで列数 1〜`LIST_MAX_COLS` の順に試し、**最初に収まった組**を返す（フォント優先、同じフォントなら列が少ない方）。収まる条件: 行数 `rows = ceil(count / cols)` について、高さ `rows * ROW_HEIGHT_EM * px + (rows - 1) * ROW_GAP_EM * px <= box.height`、列の幅 `(box.width - (cols - 1) * colGapPx) / cols >= (ROW_FIXED_WIDTH_EM + NAME_MIN_WIDTH_EM) * px`。どれも収まらなければ `null`。
  `count` が 0 のときは `{ px: LIST_MAX_PX, cols: 1, rows: 0 }`。

- [ ] **Step 1: 失敗するテストを書く**（**性質のテスト**。定数の写しではなく、振る舞いを確かめる）
  - 「1920×1080 の箱（1728×713、列間 23）・1366×768（1229×507、16）・1280×720（1152×475、15）で、`LIST_PAGE_SIZE`（40）人以下のすべての人数で、結果が `null` でなく `px >= 20`」
  - 「返った組は実際に収まる: 高さと列幅の式を**テストの中で独立に**計算し直して満たしている」
  - 「人数が増えても文字は大きくならない（`px` は非増加）。列数は減らない（`cols` は非減少）」（1〜40 人を総当たり）
  - 「中人数（15〜40 人）で、連続する人数の間の `cols` の差は 1 以下」
  - 「1 人・0 人でも例外にならない」「40 人を超える極端な人数（例: 200 人）では `null`（収まらないことを正直に返す）」
  - 「箱が極端に小さい（例: 300×100）と `null`」
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client/list-layout.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装** — 上のとおり。
- [ ] **Step 4: 実行して成功を確認** — 同じコマンドと `pnpm typecheck && pnpm lint`。Expected: PASS。もし 1 人増えただけで列数が 2 以上飛ぶ人数があれば、ここで列の増やし方を見直す。
- [ ] **Step 5: Commit** — `feat(live): 一覧の文字の大きさと列数を計算する純関数を追加`

---

### Task 3: 投影画面の一覧を計算結果で描画し、名前を 1 行で省略する

**Files:**
- Modify: `apps/live/src/client/screen/useFitToBox.ts`（DOM を測って試す方式をやめ、`chooseListLayout` の結果を適用する）, `apps/live/src/client/screen/FittedList.tsx`, `apps/live/src/client/screen/list-header.ts`, `apps/live/src/client/screen/ScreenContent.tsx`, `apps/live/src/client/styles.css`
- Delete: `apps/live/test/client/fit-candidates.test.ts`（`fitCandidates` は廃止。`list-layout.test.ts` に置き換わる）
- Test: `apps/live/test/client/list-layout.test.ts`（Task 2）、`apps/live/test/client/list-header.test.ts`

**Interfaces:**
- `useFitToBox(entries)` は、箱の大きさ（`el` の `clientWidth` と、CSS の `max-height` を解決した高さ）と列間（`getComputedStyle(el).columnGap`）を読み、`chooseListLayout(entries.length, box, colGap)` の結果を `fontSize` と `gridTemplateColumns` に適用する。`null` のときは最小の `LIST_MIN_PX` と `LIST_MAX_COLS` を適用する（スクロールにはしない。`overflowY` は常に `hidden`）。`resize` で再計算する。
- `listHeader(entries, page, pageCount)` — 範囲の見出しに、`pageCount >= 2` のとき `（<page+1>/<pageCount>）` を添える。
- `styles.css`: `.host-list-grid .host-name` を `flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`（折り返さない）。`.host-list-grid li` の行の高さを `ROW_HEIGHT_EM` と一致させる（`line-height` と `padding` を `ROW_HEIGHT_EM = 1.6` になる値に固定）。

- [ ] **Step 1: 失敗するテストを書く** — `list-header.test.ts`: 「1 ページだけなら今の見出し」「複数ページなら `16 位〜55 位（1/3）`」「空なら `4 位以下はいません`」
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client/list-header.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装** — 上のとおり。
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 投影画面の一覧を計算で収め、名前を 1 行で省略する`

---

### Task 4: 幹事画面のページ送りボタンと、結合テスト

**Files:**
- Modify: `apps/live/src/client/host/host-action.ts`（`hostActionLabel`）, `apps/live/src/client/host/HostPanel.tsx`
- Test: `apps/live/test/client/host-action.test.ts`, `apps/live/test/worker/socket.test.ts`

**Interfaces:**
- `hostActionLabel(view)`: 一覧で `page + 1 < pageCount` なら `次のページへ（${page + 2}/${pageCount}）`。最後のページなら今のまま（`nextRank === null` で `null`、そうでなければ `${nextRank} 位を発表`）。
- `HostPanel`: 一覧のパネルに `ページ ${page + 1} / ${pageCount}` を出す。

- [ ] **Step 1: 失敗するテストを書く**
  - `host-action.test.ts`: 「1 ページ目（全 3 ページ）のラベルは `次のページへ（2/3）`」「最後のページは `3 位を発表`」「最後のページで `nextRank: null` なら `null`」「1 ページだけの一覧は今までどおり」
  - `socket.test.ts`（Workers）: 「4 位以下が 41 人のとき、幹事が `advance` すると投影画面に `list` の 1 ページ目（40 行）、続けて 2 ページ目（1 行）、その次に表彰台の `screen_view` が届く」「同じ `from` を 2 回送っても 1 ページだけ進む」「ページ 2 の状態で投影画面を開き直すと、同じページの `screen_view` が届く」「幹事の `host_view` の `page` / `pageCount` も同じ」
- [ ] **Step 2: 実行して失敗を確認** — `pnpm exec vitest run test/client/host-action.test.ts` と `pnpm exec vitest run --config vitest.workers.config.ts test/worker/socket.test.ts`。Expected: FAIL。
- [ ] **Step 3: 実装**
- [ ] **Step 4: 実行して成功を確認** — `pnpm test && pnpm typecheck && pnpm lint`。Expected: PASS。
- [ ] **Step 5: Commit** — `feat(live): 幹事のボタンで結果一覧のページを送る`

---

### Task 5: 実機（ブラウザ）での確認

**Files:** なし（確認のみ。必要なら `LIST_PAGE_SIZE` を調整してコミット）

- [ ] **Step 1: dev サーバーを起動する** — `XDG_CONFIG_HOME` を `$TMPDIR` 配下に向け、`pnpm --filter live dev`。
- [ ] **Step 2: 120 人の開催回を作る** — 20 文字のニックネームを混ぜる（`scripts/loadtest.ts` のゲスト名を、一部 20 文字にしたものを使うか、確認用のスクリプトで 120 人を作る。確認用の変更はコミットしない）。`loadtest` で最後の問題まで進め、結果一覧にする。
- [ ] **Step 3: 3 サイズで全ページを開く** — 1920×1080、1366×768、1280×720 で投影画面を開き、幹事の advance で全ページ（3 ページ）を送りながら、各ページのスクリーンショットを撮る。各ページで、スクロールバー・見切れがないこと、採用された `font-size` と列数（要素の `style` から読む）が 20px 以上であることを確かめる。
- [ ] **Step 4: 結果を記録する** — 3 サイズ × 3 ページの `font-size` と列数を表にして報告する。20px を割る組があれば `LIST_PAGE_SIZE` を下げてコミットする。

---

## ユーザーに確認すること

1. **1 ページの人数（既定 40）**: 手計算では 1280×720 で約 22px。実機で 20px を割る画面があれば自動で 36 などに下げる（定数 1 つ）。40 のままでよいか。
2. **投影画面のページ表示**: 見出しに `（1/3）` を添える案。要らなければ外す。

## 作業量の見積もり

約 3〜4 時間。Task 1: 1 時間、Task 2: 45 分、Task 3: 45 分、Task 4: 45 分、Task 5（実機確認）: 30〜45 分。
