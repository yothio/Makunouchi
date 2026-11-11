# live のデプロイ

`apps/live`（Cloudflare Workers + Durable Object）の初回デプロイと、GitHub Actions からのデプロイ手順です。ローカル開発は [apps/live/README.md](../../apps/live/README.md) を見てください。

凡例: `<...>` は自分の値に置き換えます。秘密の値はコマンド引数やシェル履歴に書かず、対話入力かパイプで渡します。

Worker 名は `wrangler.jsonc` の `name`（`makunouchi-live`）です。デプロイ先の既定は `https://makunouchi-live.<サブドメイン>.workers.dev` です。

---

## 1. 前提の準備

**目的**: デプロイできる手元環境を揃える。

```
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter live exec wrangler --version
pnpm --filter live exec wrangler login
pnpm --filter live exec wrangler whoami
```

**確かめること**

- Node は 22 以上（CI は 24）。pnpm はルート `package.json` の `packageManager` に合う
- `whoami` に、デプロイしたい Cloudflare アカウントが出る
- 複数アカウントがあるときは、デプロイ時に正しいアカウントを選ぶ（非対話なら環境変数 `CLOUDFLARE_ACCOUNT_ID`）

---

## 2. 事前確認（ローカル）

**目的**: 本番に出す前に、テストとビルドが通ることを確かめる。

```
pnpm --filter live test
pnpm --filter live typecheck
pnpm --filter live lint
pnpm --filter live build
```

**確かめること**

- Node 環境と Workers 環境のテストが通る
- `load.test.ts` が 150 接続で、問題の advance では全員への `guest_view` と投影の `screen_view`、表彰台の操作では `host_view` / `screen_view` が 2000 ms 以内に届き、ゲストが `results_pending` のままであること

必要なら dry-run もできます（本番には公開しません）。

```
pnpm --filter live exec wrangler deploy --dry-run --outdir /tmp/makunouchi-live-dry-run
```

出力の binding に `SESSION_ROOM` と `ASSETS` が出ることを確認します。`--dry-run` の前に `build` を済ませておくと確実です。

---

## 3. 初回デプロイ

**目的**: Worker と Durable Object を Cloudflare に作る。

順序は **先にデプロイ、次に secret 登録** です。secret 未設定の間は開催回の作成や幹事・投影の接続が 500 で断られ（fail closed）、危険な公開状態にはなりません。

```
pnpm --filter live run deploy
```

`deploy` は `vite build` のあと `wrangler deploy` を実行します。**`run` を省いた `pnpm deploy` / `pnpm --filter live deploy` は使わないでください。** `deploy` は pnpm 組み込みのコマンドでもあり、`ERR_PNPM_INVALID_DEPLOY_TARGET` で失敗します。`wrangler.jsonc` の `upload_source_maps: true` は、解決できない source map があるとデプロイを失敗させる。デプロイが失敗したら source map を疑う。

**確かめること**

- migration `v1`（`new_sqlite_classes: SessionRoom`）が初回に適用される旨が出る
- 出力またはダッシュボードに `https://makunouchi-live.<サブドメイン>.workers.dev` が出る。この URL を控える（admin の `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` で使う。リポジトリには書かない）
- 疎通:

  ```
  curl --silent --show-error https://<makunouchi-live の URL>/api/health
  ```

  `{"ok":true}` が返る。`/` をブラウザで開くと SPA が表示される

### secret 未設定のときのふるまい

| リクエスト | 結果 |
| --- | --- |
| `GET /api/health` | 200 |
| 静的アセット（SPA） | 配信される |
| `PUT /api/sessions/:id` など保護 API | 500 `misconfigured` |
| `/ws/:id/host`、`/ws/:id/screen` | 500 |
| `/ws/:id/guest` | secret は使わない（開催回が無ければ使えない） |

---

## 4. ADMIN_API_SECRET の登録

**目的**: admin と同じ値を live に入れる（本番は 32 文字以上）。

admin 側で Secret Manager などを使っている場合は、**同じ値**を入れます。片方だけ変えると `PUT /api/sessions` が 401 になり、投影画面のトークンも合いません。

### 4.1 末尾の改行・空白

`wrangler secret put` は標準入力の末尾の空白・改行を除いて登録します。admin 側の値が末尾改行付きだと、live と必ずずれます。登録前に、admin 側の秘密の長さが期待どおりで、末尾に改行が無いことを確かめてください（値そのものは画面に出さない）。

長さの目安: `openssl rand -hex 32` なら 64 バイト。65 なら改行が入っています。

### 4.2 登録

対話入力（値はコマンドに書かない）:

```
cd apps/live
pnpm exec wrangler secret put ADMIN_API_SECRET --name makunouchi-live
```

admin の Secret Manager からパイプする場合（プロジェクト・secret 名はプレースホルダ。値は画面にも履歴にも出ない）:

```
cd apps/live
gcloud secrets versions access latest --secret=<ADMIN_API_SECRET_NAME> --project=<PROJECT_ID> | pnpm exec wrangler secret put ADMIN_API_SECRET --name makunouchi-live
```

- **`--name makunouchi-live` は必ず付ける。** 打ち間違えると別名の Worker ができる
- Worker が無い状態でパイプ入力の `secret put` をすると、確認なしで draft Worker ができることがある。そのため初回はデプロイを先にする
- `secret put` は新しいバージョンを即デプロイする。**進行中は実行しない**

**確かめること**

- 成功メッセージが出る
- 名前だけ確認する（値は出ない）:

  ```
  pnpm exec wrangler secret list --name makunouchi-live
  ```

- 認証なしの PUT が `401` になる（`500` ではない）:

  ```
  curl --silent --output /dev/null --write-out "%{http_code}\n" --request PUT https://<makunouchi-live の URL>/api/sessions/check-unauthorized
  ```

### 4.3 secret を変えたとき

- admin と live の両方を同じ値に揃え、両方に反映する
- 既に作った開催回の投影画面 URL のトークンは無効になる。当日直前には変えない
- 進行前にデプロイを伴わず secret だけ用意するときは `wrangler versions secret put` を使い、反映は `wrangler versions deploy` で進行外に行う

---

## 5. admin 側の URL 設定

**目的**: admin が live を呼ぶ先と、参加者に見せる URL の元を実際の live URL にする。

admin の Cloud Run サービスに次を設定します（末尾の `/` は付けない）。

| 変数 | 用途 |
| --- | --- |
| `LIVE_BASE_URL` | Rails → Worker の API ベース |
| `LIVE_PUBLIC_URL` | 開催回詳細のゲスト・幹事・投影 URL の元。未設定だと URL の先頭が欠ける |

例（プレースホルダ。他の環境変数を消さないよう `--update-env-vars` を使う。`--set-env-vars` は使わない）:

```
gcloud run services update <SERVICE_NAME> --project <PROJECT_ID> --region <REGION> --update-env-vars LIVE_BASE_URL=https://<makunouchi-live の URL>,LIVE_PUBLIC_URL=https://<makunouchi-live の URL>
```

**確かめること**

- 新しいリビジョンが増えている
- 環境変数の**値全体**を `describe` で出さない（秘密が平文で出ることがある）。名前の一覧かコンソールで `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` があることを見る
- **この設定を終えるまで、admin で開催回を作らない**（仮 URL のままだと PUT が失敗し、開催回が `pending` のまま残ることがある）

詳細な admin 側の初回設定は [admin.md](admin.md) を見てください。

---

## 6. GitHub Actions でのデプロイ

live の本番デプロイは GitHub Release の公開をきっかけにします。人が触る CI は `release` の `workflow_dispatch`（対象 `live`）だけです。`main` への push では動きません。

流れは次のとおりです。

1. `.github/workflows/release.yml` を `main` から手動起動する（対象 `live`）
2. 日本時間の現在時刻からタグ名 `live-YYYYMMDD-HHMM`（例: `live-20261109-1530`）を決める。同じ名前のタグか Release が既にあれば止める
3. 同じ対象の未公開 Draft があれば消してから、起動時の `main` のコミット SHA を `--target` にした Draft Release を作る（ブランチ名ではなく SHA）
4. GitHub の Releases 画面で Draft の内容を確かめ、公開（Publish）する。公開でタグが作られる
5. `live-deploy.yml` が `release: published` で動き、タグ名が `live-YYYYMMDD-HHMM` のときだけ進む（`app-*` や prerelease はジョブをスキップする。失敗にはしない）

`GITHUB_TOKEN` が起こすイベントは `workflow_dispatch` と `repository_dispatch` を除き他ワークフローを起動しません。Draft の作成は `GITHUB_TOKEN` で行い、公開は人が行うので、公開後の `release: published` でデプロイが起動します。PAT や GitHub App は使いません。

`live-deploy.yml` が、タグのコミットが `main` に含まれることを確かめたあと、そのタグでテスト・型検査・lint を流し、`pnpm --filter live run deploy` を実行します。`ADMIN_API_SECRET` は CI から触りません。`wrangler deploy` は Worker に登録済みの secret を消しません。

Draft を公開するとタグが付き、そのあとデプロイ前のテスト・型検査・lint が走ります。デプロイが落ちてもタグと Release は残ります。直したら新しい Draft を作り直して公開してください（同名タグは作れません）。誰でもタグを作れないよう、タグの ruleset で `live-*`（と `app-*`）の作成を制限してください。Release の公開は書き込み権限がある人ができるので、公開できる人も合わせて限ってください。

### 6.1 初回の設定

**目的**: CI から Workers へデプロイできる認証を GitHub に置く。

1. Cloudflare ダッシュボードの Account API tokens でトークンを作る。
   - 権限のテンプレートは「Edit Cloudflare Workers」（公式の GitHub Actions 手順が使うもの）
   - 対象アカウントはデプロイ先の 1 つに限定する
   - このリポジトリのデプロイが主に使うのは Workers Scripts の編集。絞りたいときはカスタムトークンで必要な権限だけにする（絞ったら初回のリリースで通ることを確かめる）。テンプレートに権限は足さない
   - トークンの値は作成時に一度だけ表示される
2. GitHub に repository secrets を登録する。値は対話入力で渡し、コマンドに書かない。

   ```
   gh secret set CLOUDFLARE_API_TOKEN --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo <OWNER>/<REPO>
   ```

   アカウント ID はダッシュボードか `wrangler whoami` で確かめる。
3. ワークフローは `environment: production` で動く（admin のデプロイと共用）。Deployment branches and tags を次のようにする。`release: published` のときの ref はタグになる。

   画面から: Settings → Environments → `production` → Deployment branches and tags で「Selected branches and tags」を選ぶ。

   - タグ: `app-*` と `live-*`（付けないと environment で止まる。この文書では設定手順だけ示し、代行では変えない）

   コマンドから（既存設定が変わることがあるので、先に画面で現状を見る）:

   ```
   gh api --method PUT repos/<OWNER>/<REPO>/environments/production -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   ```

   ```
   gh api --method POST repos/<OWNER>/<REPO>/environments/production/deployment-branch-policies -f name=app-* -f type=tag
   ```

   ```
   gh api --method POST repos/<OWNER>/<REPO>/environments/production/deployment-branch-policies -f name=live-* -f type=tag
   ```

4. **タグの ruleset** をリポジトリに作る（Settings → Rules → Rulesets）。`app-*` と `live-*` の作成・更新・削除を、リリース担当だけに限る。Release の公開は書き込み権限がある人ができるので、公開できる人も合わせて限る。この文書では設定手順だけ示し、代行では作らない。

### 6.2 起動のしかた

通常のリリース（Draft 作成 → 画面で公開 → デプロイ）。`main` 以外から起動したときは、Draft を作る前に止まります。

```
gh workflow run release.yml --repo <OWNER>/<REPO> --ref main -f target=live
```

画面からは Actions → `release` → Run workflow。ブランチは `main`、対象は `live`。Draft ができたら Releases で内容を確かめ、Publish release する。

**確かめること / 注意**

- **本番の進行中は Draft を公開しない**（全員の WebSocket が切れる）
- ログには `workers.dev` の URL を出さないよう、`wrangler deploy` の標準出力は捨てている。アカウント ID は `::add-mask::` で伏せる。成否は終了コード、エラーは標準エラー出力
- デプロイ後の URL はダッシュボードの Workers & Pages で見る
- `WRANGLER_SEND_METRICS=false` で wrangler の利用データ送信を止めている

### 6.3 ロールバック

デプロイの手動起動はない。戻したいコミットが `main` の上にあるなら、revert して新しい Draft Release を作り公開する。急ぐときは手元の wrangler で戻す。進行中は実行しない。

```
cd apps/live
pnpm exec wrangler versions list
pnpm exec wrangler rollback <バージョン ID> --message "<理由>"
```

Durable Object の構成（`migrations` など）が変わったバージョン間は戻せません。開催回のデータは DO に残りますが、コードと状態の形が合わないと使えなくなることがあります。

---

## 7. 本番での seed と負荷試験

秘密は環境変数 `ADMIN_API_SECRET` で渡します。値をコマンドに埋め込んで `export` すると履歴に残るので避け、次のどちらかにします。

方法 A: 対話入力（終わったら消す）:

```
read -s ADMIN_API_SECRET
export ADMIN_API_SECRET
pnpm --filter live seed https://<makunouchi-live の URL>
pnpm --filter live loadtest https://<makunouchi-live の URL> <sessionId> --clients 150
unset ADMIN_API_SECRET
```

方法 B: Secret Manager から 1 コマンドだけに付ける（プレースホルダ）:

```
ADMIN_API_SECRET="$(gcloud secrets versions access latest --secret=<ADMIN_API_SECRET_NAME> --project=<PROJECT_ID>)" pnpm --filter live seed https://<makunouchi-live の URL>
```

方法 B は、Secret Manager 側に改行があっても live 側の trim と合ってしまい、admin との食い違いを隠すことがあります。4.1 の確認の代わりにはなりません。

**確かめること**

- 負荷試験はロビー状態の新しい開催回に対して実行する。進めた回は戻せないので、試験のたびに `seed` し直す
- 合格: 問題の advance（ゲスト・投影）と表彰台の各操作（幹事・投影）で p100 が 2000 ms 以下、取りこぼし 0、ゲストは `results_pending` のまま。最後に `PASS` または `FAIL`
- 試験用の開催回は本番に使わない。できればスマホのテザリング回線から行う
- `seed` / `loadtest` の出力に幹事 PASS や投影トークンが出る。貼り付け・共有しない

---

## 8. リハーサルと本番前チェックリスト

1. リハーサル用の開催回を admin または `seed` で作る。本番用はリハーサルの後に作る
2. リハーサル回で `loadtest ... --clients 150` を実行し、PASS を確認する
3. 実機:
   - ゲスト: 同じ端末の 2 タブで同名参加は拒否。参加後のリロードで同じ参加者に復帰。別ブラウザからは復帰しない
   - 投影画面: 16:9。参加人数の上限に近い一覧と、10 人以下の一覧
   - 幹事と投影を別タブ（本番は別 PC）で開き、連動とリロード復帰を確認
4. 公開前の確認:
   - デプロイ済み環境で `seed` と `loadtest --clients 150`（できればテザリング）
   - 投影用 PC で 1280×720 と 1920×1080。結果一覧は 9〜10 / 24〜30 / 82〜97 人付近
   - iPhone（LINE 内ブラウザと Safari）で、問題表示中に Wi-Fi を切って再接続・回答
5. 本番用の開催回を作り、ゲスト URL（QR）と投影画面 URL を用意する

**当日の注意**

- 進行中は `deploy` も `secret put` もしない
- 結果発表の形式を変えたデプロイのあと、デプロイ前に作った開催回（特に結果発表に入ったもの）は使わず作り直す

---

## 9. よくある失敗

| 症状 | 原因と対処 |
| --- | --- |
| `PUT /api/sessions` が 401 | admin と live の `ADMIN_API_SECRET` が違う。改行の混入も疑う |
| どの API も 500 `misconfigured` | live に secret が無い、または 32 文字未満 |
| 参加者 URL の先頭が欠ける | admin の `LIVE_PUBLIC_URL` が未設定 |
| `pnpm deploy` が失敗する | `run` を付けて `pnpm --filter live run deploy` にする |
| migration で失敗する | 一度適用した `migrations` の `tag` を書き換えない |
| 投影画面が 401 | トークンが古い（secret 変更、または別開催回の URL） |

---

## 10. 独自ドメイン（任意）

1. ドメインの DNS を Cloudflare で管理する
2. `wrangler.jsonc` に custom domain 用の `routes` を追加する（公式の Routes and domains を確かめてから）
3. デプロイし直し、`LIVE_PUBLIC_URL`（必要なら `LIVE_BASE_URL` も）を更新する
4. 既に作った開催回の URL は古いままなので作り直す。進行中は変えない
