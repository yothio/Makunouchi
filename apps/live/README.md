# live (結婚式クイズ ライブアプリ)

Cloudflare Workers + Durable Object (SessionRoom) + React。1 開催回の参加者は最大 120 人程度を想定し、負荷試験は 150 接続で行う。

## ローカル開発

1. `apps/live/.dev.vars.sample` をコピーして `apps/live/.dev.vars` を作る（`.dev.vars` は git 管理外）。

   ```
   cp apps/live/.dev.vars.sample apps/live/.dev.vars
   ```

   `.dev.vars` は起動時にだけ読み込まれるので、作成・変更したら `pnpm dev` を再起動する。

2. `pnpm --filter live dev` で起動する（既定は <http://localhost:5173>）。
3. 開催回を作る。

   ```
   ADMIN_API_SECRET=dev-secret-change-me-0123456789abcdef pnpm --filter live seed http://localhost:5173
   ```

   `fixtures/sample-quiz.json`（5 問）を `PUT /api/sessions/:id` で登録し、新しい sessionId（`crypto.randomUUID()`）、ゲスト URL（`/s/:id`）、幹事画面 URL（`/host/:id?token=...`）、投影画面 URL（`/screen/:id?token=...`）を表示する。幹事画面は手元の端末で進行操作に使い、投影画面は会場のプロジェクターにつないだ別の PC で開く。別の問題ファイルを使うときは第 2 引数に JSON のパスを渡す。

## テスト

- `pnpm --filter live test`: Node 環境のテストと Workers 環境のテスト。
- `test/worker/load.test.ts`: 同一プロセス内で 150 ゲスト + 1 ホストを接続し、サンプルクイズを進行させる自動テスト。advance ごとに、150 人全員へ新しい `guest_view` が 2000 ms 以内に届くこと（取りこぼし 0）を確認する。
- `pnpm --filter live typecheck`, `pnpm --filter live build`
- `pnpm --filter live lint`: oxlint（設定は `.oxlintrc.json`）。`lint:fix` で自動修正できるものを直す。

## コンポーネントの書き方

- 分岐やロジックを持つコンポーネントは 1 ファイル 1 コンポーネントにし、ファイル名はコンポーネント名（PascalCase）に合わせる。App 系のファイルは「どの画面を出すか」だけを決める。
- 分岐もロジックも持たない表示だけの部品は切り出さず、呼び出し元の `return` に直接書く。
- JSX は `return` の中にだけ書く。変数への代入、`useMemo`、ヘルパー関数の中で JSX を組み立てない（`switch` で画面を選ぶ複数の `return <X />` は可）。
- `return` より前に書くのは hook 呼び出しと単純な派生値だけにする。状態・ソケット処理・タイマー・キーボード・DOM 計測などのロジックは `useXxx.ts` のカスタムフックか `.ts` の純関数に出す。
- 三項演算子のネストは 1 段まで。それ以上になるときは、`switch` で選ぶ小さなコンポーネントに分ける。
- このパッケージの関数はすべて `const` のアロー関数で書く（oxlint の `func-style` が検査する。クラスのメソッドは対象外）。JSX を `return` の中に限る規則は oxlint では検査できないので、レビューで確認する。

## デプロイ

```
cd apps/live
pnpm exec wrangler secret put ADMIN_API_SECRET   # 本番の秘密値を入力（32 文字以上。例: openssl rand -hex 32 で生成）
pnpm --filter live deploy
```

`deploy` は `vite build` のあと `wrangler deploy` を実行する。デプロイ先は `https://makunouchi-live.<account>.workers.dev`（`wrangler.jsonc` の `name`）。

`ADMIN_API_SECRET` は Rails 側（`apps/admin`）と同じ値にする。Rails は `Authorization: Bearer <ADMIN_API_SECRET>` で API を呼び、`hostToken = HMAC-SHA256(ADMIN_API_SECRET, sessionId)`（hex）で幹事画面 URL を、`screenToken = HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)`（hex）で投影画面 URL を作る。開催回 ID は英数字・`_`・`-` のみ（100 文字まで）。

**本番の進行中は絶対にデプロイしない（全員の接続が切れる）。**

## 本番での seed と負荷試験

秘密値は環境変数 `ADMIN_API_SECRET` で渡す（未設定ならスクリプトは明確なメッセージで終了する）。

```
export ADMIN_API_SECRET=<本番の値>
pnpm --filter live seed https://makunouchi-live.<account>.workers.dev
# 表示された sessionId を使う
pnpm --filter live loadtest https://makunouchi-live.<account>.workers.dev <sessionId> --clients 150
```

- 負荷試験は、ロビー状態の新しい開催回に対して実行する。開催回は 1 回進めると戻せないので、試験のたびに `seed` で作り直す。
- 150 ゲスト（ランダムなニックネーム `guest-N`）と 1 ホストを接続し、全問を進めて、各 open で全ゲストがランダムに回答する。最初の結果一覧（`r:list`）に入った時点で終了し、その後の `select` / `show_rank` が参列者に届かないことも確認する。
- 各 advance について、送信から 150 人全員に新しい `guest_view` が届くまでの最大時間（p100）と、届かなかった人数を表示する。
- 合格条件: すべての advance で p100 が 2000 ms 以下、かつ取りこぼし 0。最後に `PASS` または `FAIL` を表示し、終了コードは合格なら 0。
- 試験用の開催回は本番に使わない。

## 本番前のチェックリスト

1. リハーサル用の開催回を `seed`（または Rails から）作る。本番用の開催回はリハーサルの後に作る。
2. リハーサル回で `loadtest ... --clients 150` を実行し、PASS を確認する。
3. 実機チェック（未実施。ブラウザでの確認が必要）:
   - ゲスト: 同じ端末で 2 タブを開き、同じニックネームで参加すると拒否される。参加後にリロードしても同じ参加者として復帰する。別ブラウザからは復帰しない。
   - 投影画面: 16:9 で崩れずに収まる。特に ~97 人の一覧（参加人数の上限に近い数）と、10 人以下の一覧の両方を確認する。
   - 幹事画面と投影画面を別のタブ（本番は別の PC）で開き、幹事画面の操作に投影画面が連動する。投影画面をリロードしても、現在の段階から再開される。
4. 公開前のゲート（最初のリハーサルの前に必ず行う）:
   - 実際にデプロイした環境に対して `seed` と `loadtest --clients 150` を実行する（できればスマホのテザリング回線から）。
   - 実際の投影用 PC のブラウザで、1280×720 と 1920×1080 の両方を確認する。結果一覧は 9〜10 人、24〜30 人、82〜97 人の 3 パターンで、切れずに表示される（収まらない場合はスクロールできる）ことを見る。
   - iPhone（LINE アプリ内ブラウザと Safari の両方）で、問題の表示中に Wi-Fi を切って入れ直し、再接続して回答できることを確認する。
5. 本番用の開催回を作り、ゲスト URL（QR コード）と投影画面 URL を配布・用意する。
