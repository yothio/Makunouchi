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

   `fixtures/sample-quiz.json`（5 問 + 幹事 `host`）を `PUT /api/sessions/:id` で登録し、新しい sessionId（`crypto.randomUUID()`）、ゲスト URL（`/s/:id`）、幹事画面 URL（`/host/:id`、トークンなし）、幹事トークン URL（緊急時）、投影画面 URL（`/screen/:id?token=...`）、幹事 ID/PASS を表示する。`host` を省略した JSON でも従来どおり作れる（その場合はトークン URL のみ）。幹事画面は手元の端末で進行操作に使い、投影画面は会場のプロジェクターにつないだ別の PC で開く。別の問題ファイルを使うときは第 2 引数に JSON のパスを渡す。

   幹事は `/host/:id` で ID/パスワードを入れて入る。トークン付き URL も残してある（`seed` / `loadtest`・開発・緊急時、およびログイン失敗でロックされたときの非常口）。当日の前に一度ログインして画面を開いておく（リハーサルで確認する）。sessionStorage が使えない環境では、ページを開いている間だけトークンがメモリに残り、リロードするとログインし直しになる。

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

Node は 22 以上（`wrangler` の要件。CI は 24）。リポジトリに `.nvmrc` や `engines` の指定はない。

先にデプロイし、そのあとで秘密値を登録する。秘密値が未登録の間の Worker は、開催回の作成や幹事・投影画面の接続を 500 で断る（fail closed）。

```
pnpm --filter live run deploy
```

```
cd apps/live
pnpm exec wrangler secret put ADMIN_API_SECRET --name makunouchi-live
```

- `deploy` は `vite build` のあと `wrangler deploy` を実行する。`run` を省いた `pnpm deploy` は pnpm 組み込みのコマンドになり失敗するので、`run` を付ける。
- `secret put` は本番の秘密値を対話入力する（32 文字以上。例: `openssl rand -hex 32` で生成）。入力の末尾の空白・改行は wrangler が除く。`--name` を間違えると別名の Worker ができるので必ず付ける。`secret put` も新しいバージョンを即デプロイするので、進行中は実行しない。
- デプロイ先は `https://makunouchi-live.<サブドメイン>.workers.dev`（`wrangler.jsonc` の `name`）。

`ADMIN_API_SECRET` は Rails 側（`apps/admin`）と同じ値にする。Rails は `Authorization: Bearer <ADMIN_API_SECRET>` で API を呼び、開催回作成時に幹事の ID とパスワードのハッシュ（`host`）を送る。投影画面 URL は `screenToken = HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId)`（hex）。幹事 HMAC トークンはログイン成功時に Worker が返し、Rails は計算も表示もしない（緊急時のトークン URL は `seed` など Worker 側で出す）。開催回 ID は英数字・`_`・`-` のみ（100 文字まで）。

**本番の進行中は絶対にデプロイしない（全員の接続が切れる）。**

**結果発表を「自由な順番で選ぶ形」に変えた変更をデプロイしたあとは、デプロイ前に作った開催回（特に結果発表に入ったもの）は使わず、作り直す。** 旧実装（固定の発表順・表彰台）で保存された状態は、新しい結果フェーズのキーや画面と合わず、`r:undefined:hidden` のような不正な段階になることがある。

## GitHub Actions でのデプロイ

`.github/workflows/live-deploy.yml` が、テスト・型検査・lint のあとに `pnpm --filter live run deploy` を実行する。`main` への push では動かず、手動起動（`workflow_dispatch`）だけで動く。`ADMIN_API_SECRET` は CI から触らない。`wrangler deploy` は Worker に登録済みの secret を消さない（公式: 「Secrets are never deleted by a deployment」）ので、初回に手で登録した値が保たれる。

### 初回の設定

1. Cloudflare ダッシュボードの Account API tokens で、トークンを作る。
   - 権限のテンプレートは「Edit Cloudflare Workers」（公式の GitHub Actions の手順が使うもの）。
   - 対象のアカウントは、デプロイ先の 1 つに限定する。
   - 追加の権限は付けない。トークンの値は作成時に一度だけ表示される。
2. GitHub に repository secrets を登録する。値は対話入力で渡し、コマンドに書かない。

   ```
   gh secret set CLOUDFLARE_API_TOKEN --repo yothio/Makunouchi
   ```

   ```
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo yothio/Makunouchi
   ```

   アカウント ID はダッシュボードのアカウントのメニューか `wrangler whoami` で確かめる。
3. ワークフローは `environment: production` で動く。リポジトリの Settings → Environments に `production` があることを確かめる（admin のデプロイと共用）。

### 起動のしかた

入力 `confirm` に Worker 名 `makunouchi-live` を入れる。一致しないとき、`main` 以外のブランチから起動したときは、デプロイの前に止まる。

```
gh workflow run live-deploy.yml --repo yothio/Makunouchi --ref main -f confirm=makunouchi-live
```

画面からは、GitHub の Actions タブで `live-deploy` を選び、Run workflow でブランチ `main` を選んで `confirm` に `makunouchi-live` を入れる。

- **本番の進行中は起動しない**（全員の WebSocket が切れる）。当日の前後は、起動する前に進行が終わっていることを確かめる。
- ログには `workers.dev` の URL を出さないよう、`wrangler deploy` の標準出力は捨てている（`WRANGLER_LOG=error` も指定）。アカウント ID は `::add-mask::` で伏せる。成否は終了コードで決まり、エラーは標準エラー出力に出る。デプロイ後の URL はダッシュボードの Workers & Pages で見る。
- `WRANGLER_SEND_METRICS=false` で wrangler の利用データ送信を止めている。

### ロールバック

手元から戻す。進行中は実行しない。

```
cd apps/live
pnpm exec wrangler versions list
pnpm exec wrangler rollback <バージョン ID> --message "<理由>"
```

Durable Object の構成（`migrations` など）が変わったバージョン間は戻せない。

## 本番での seed と負荷試験

秘密値は環境変数 `ADMIN_API_SECRET` で渡す（未設定ならスクリプトは明確なメッセージで終了する）。

```
export ADMIN_API_SECRET=<本番の値>
pnpm --filter live seed https://makunouchi-live.<サブドメイン>.workers.dev
# 表示された sessionId を使う
pnpm --filter live loadtest https://makunouchi-live.<サブドメイン>.workers.dev <sessionId> --clients 150
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
