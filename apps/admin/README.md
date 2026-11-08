# apps/admin（管理画面）

結婚式クイズの管理画面（Rails 8）。システム管理者・主催者が問題と開催回を準備する。当日の進行は `apps/live` が受け持つ。結果の取り込み・保存はしない（`ranking` API も呼ばない）。
計画は `docs/superpowers/plans/2026-11-07-admin.md`。

> **admin は Rails のみ。JS パッケージにしない。** ルートの `pnpm-workspace.yaml` は `apps/*` を対象にするが、`apps/admin` に `package.json` を置かない限り無視される。置かないこと。

## 構成

- DB は Neon の PostgreSQL の **primary 1 つだけ**。cache / queue 用の別 DB は持たない。
- キャッシュはメモリ（`:memory_store`）、Active Job は `:async`。`solid_cache` / `solid_queue` は使わない。
- 画像は Cloudflare R2（S3 互換）。本番はブラウザから R2 に直接アップロードする（Active Storage の direct upload）。
- デプロイは Cloud Run。Kamal は使わない。
- 待ち受けは `PORT`（Cloud Run が渡す。無いときの本番既定は 8080）。health は `/up`。

## 環境変数

秘密はすべて環境変数（または Secret Manager）で渡し、**リポジトリにコミットしない**。

| 変数 | 必須 | 用途 |
|---|---|---|
| `DATABASE_URL` | 本番必須 | アプリ用。Neon の **pooled** 接続 URL。Cloud Run **サービス**側にはこれだけ（direct は載せない） |
| `DATABASE_URL_DIRECT` | マイグレーション時 | Neon の **direct** 接続 URL。アプリ起動では読まない。migrate/seed 用 Job（または手元）で `DATABASE_URL` に差し替えて使う |
| `TEST_DATABASE_URL` | テスト推奨 | test の接続先。未設定ならローカルの `admin_test` |
| `RAILS_MASTER_KEY` | 本番必須 | `credentials.yml.enc` 解読用。リポジトリには入れない。**作成者のローカル** `apps/admin/config/master.key` を手元で読み、Secret Manager に一度だけ保存する。クローンしただけではファイルは無い。失うと credentials の再発行が必要 |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` / `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY` / `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` | 本番必須 | 幹事パスワード暗号化。**ローカル開発**で `bin/rails db:encryption:init` を実行し、表示された 3 値を本番 Secret へ移す（production イメージ上では回さない。鍵が無いと Rails が起動できない鶏卵になる）。失うと既存開催回の PASS が読めない |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | 本番必須 | R2。欠けたら起動で落ちる |
| `R2_PUBLIC_BASE_URL` | 画像付き開催回 | 公開 https のベース（`{base}/{blob.key}`）。カスタムドメイン。`r2.dev` は本番向けでない |
| `ADMIN_API_SECRET` | live 連携必須 | live Worker と同じ値（本番は 32 文字以上）。PUT `/api/sessions/:id` の Bearer |
| `LIVE_BASE_URL` | live 連携必須 | Rails → Worker の API ベース（例: `https://makunouchi-live.<account>.workers.dev`） |
| `LIVE_PUBLIC_URL` | 本番で画面を使うなら必須 | 開催回詳細の参列者・幹事 URL の元。未設定だと URL が空（先頭が欠けたパス）になり、画面からコピーできない |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 初回 seed | システム管理者 1 人。`ADMIN_PASSWORD` は **12 文字以上**。既に管理者がいれば seed は何もしない |
| `PORT` | Cloud Run が渡す | 待ち受け。無いときの既定は本番 8080、開発・テスト 3000 |
| `RAILS_LOG_LEVEL` | 任意 | 既定 `info` |
| `RAILS_MAX_THREADS` | 任意 | Puma スレッド（既定 3） |

## ローカルで動かす

開発・テストの Active Record Encryption の鍵は `config/environments/{development,test}.rb` に捨ての固定値で入れてある（本番の鍵とは無関係）。

ローカルの Postgres が要る（`DATABASE_URL` / `TEST_DATABASE_URL`、または `PGUSER` / `PGHOST` など）。

```
bin/setup --skip-server   # bundle install と db:prepare
bundle exec rspec
bin/rails server          # http://localhost:3000
bin/rubocop               # 直せるものは bin/rubocop -a。CI は admin-lint
```

テストは RSpec（`spec/`）。1 ファイルだけ流すなら `bundle exec rspec spec/models/user_spec.rb`。`spec/config/` は設定ファイルを読むだけで Rails も DB も起動しないので、Postgres が無くても `bundle exec rspec spec/config` で流せる。テストデータは fixtures でなく factory_bot（`spec/factories/`）で作る（`create(:user)`、`create(:user, :system_admin)` のように trait で状態を選ぶ。`spec/factories_spec.rb` が factory を検証する）。添付ファイルの素材だけ `spec/fixtures/files/` に置く。

初回だけシステム管理者を作る例（パスワードは 12 文字以上）:

```
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='your-long-password' bin/rails db:seed
```

## マイグレーション

コンテナの起動時には `db:prepare` / `db:migrate` を流さない。Neon の pooled 接続（PgBouncer のトランザクションモード）はアドバイザリロックと相性が悪く、Cloud Run の複数インスタンスが同時に流すと競合するため。デプロイのたびに direct 接続で **1 回だけ** 流す（Cloud Run Jobs、またはデプロイ前の手動）。

**環境変数はアプリと同じものを渡し（`RAILS_MASTER_KEY`・`R2_*` 4 つ・Active Record Encryption の 3 つを含む。本番では `storage.yml` が起動時に読まれ、欠けると `KeyError`）、`DATABASE_URL` だけを direct に差し替える**:

```
DATABASE_URL="$DATABASE_URL_DIRECT" bin/rails db:migrate
```

## Cloud Run へのデプロイ

サービス・Job・Secret の作成は GCP コンソール（または同等の UI）での手作業を前提にする（`gcloud` の例は、CI 用の設定と手で migrate を流す場合だけ載せる）。初回は下の「ユーザーが手で行う初回設定」を済ませてから。

1. **イメージをビルド**（`apps/admin` で）:

   ```
   docker build -t admin .
   ```

2. Artifact Registry 等へタグ付けして push し、Cloud Run **サービス**を作成／リビジョン更新する。
3. **サービス設定の要点**:
   - コンテナポート: `8080`（または `PORT` に合わせる）
   - **Startup probe / Liveness probe**: HTTP `GET /up`（`force_ssl` は `/up` をリダイレクト除外済み）
   - 環境変数・Secret: 上表の本番必須項目。**`DATABASE_URL` は pooled だけ**（`DATABASE_URL_DIRECT` はサービスに常設しない）
   - 同時リクエスト数の既定（80）と Puma スレッド 3・DB `max_connections` 5 の前提を変えるときは三つを合わせて見直す
4. **デプロイごとに migrate を 1 回**（Cloud Run **Jobs**）。main への push で動く GitHub Actions（`.github/workflows/admin-deploy.yml`、後述）が自動で流す。Job の設計:
   - Job 名: `makunouchi-admin-migrate`。サービスと **同じコンテナイメージ**を使う（CI が git の SHA タグに差し替える）
   - 環境変数・Secret はサービスと同一にし、Job だけ `DATABASE_URL` を **direct**（`DATABASE_URL_DIRECT` の値）にする。CI は環境変数・Secret を上書きしない
   - args: `./bin/rails,db:migrate`
   - 実行用サービスアカウントはサービスと **同じ** `makunouchi-admin-run`（別のアカウントにするなら、そちらにも下記の `iam.serviceAccountUser` が要る）
   - **自動再実行はしない**: `--max-retries=0`（既定は 3 で、途中まで進んだ migrate が自動で繰り返される）。あわせて `--tasks=1`（既定どおり）と `--task-timeout=10m`（既定どおり。長い migrate を出すときだけ延ばす）を明記する。Job を作るときのフラグ（他のフラグはコンソールで作った Job に合わせる）:

     ```
     --tasks=1 --max-retries=0 --task-timeout=10m
     ```

   - **既に作った Job を直す**には（イメージ・環境変数・Secret は変わらない）:

     ```
     gcloud run jobs update makunouchi-admin-migrate --project yothio-rails-cloud-run --region asia-northeast1 --tasks 1 --max-retries 0 --task-timeout 10m
     ```

   - **破壊的な migration（列の削除・改名など）は 2 段階で出す**（expand → contract）。migrate が成功したあとにサービスのデプロイが失敗すると、旧コードが新しいスキーマで動く期間ができるため
   - **手で流す場合**（CI が使えないとき・調査用）は、イメージを差し替えて Job を実行する:

     ```
     gcloud run jobs update makunouchi-admin-migrate --project yothio-rails-cloud-run --region asia-northeast1 --image asia-northeast1-docker.pkg.dev/yothio-rails-cloud-run/makunouchi/admin:<git-sha>
     gcloud run jobs execute makunouchi-admin-migrate --project yothio-rails-cloud-run --region asia-northeast1 --wait
     ```

     ローカルから流すなら、本番と同じ鍵一式＋`DATABASE_URL=<direct>` で `bin/rails db:migrate`
5. **初回だけ seed**（同様に Job または手元）:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`（12 文字以上）を渡して `bin/rails db:seed`
   - 既にシステム管理者がいれば何もしない（冪等）
6. ブラウザでログインし、問題作成・開催回作成（live は stub または結合後の実 PUT）を確認

### GitHub Actions による自動デプロイ

`.github/workflows/admin-deploy.yml` が、main への push（`apps/admin/**` かこのワークフロー自身の変更）と手動実行（workflow_dispatch）で次を順に流す。どこかで失敗したら以降は動かない（migrate が失敗したらサービスはデプロイされない）。

1. `apps/admin` のイメージを `linux/amd64` でビルドし、タグを git の SHA にして Artifact Registry（`makunouchi/admin`）へ push
2. `makunouchi-admin-migrate` Job のイメージをその SHA に更新し、実行して完了を待つ
3. `makunouchi-admin` サービスを同じイメージでデプロイ

**運用ルール（テストが通る前にデプロイが走らないように）**: このワークフローは main への push で即動き、テストを待たない。そこで **main は PR 経由でのみ更新**し（直接 push しない）、管理画面のテスト（`admin-test.yml`、PR #39 で入る）と `admin-lint` を **required check**（Settings → Branches → Branch protection / Rulesets）にして、通ったものだけをマージする。

CI が変えるのはイメージだけ。環境変数・Secret・Job の args・probe は、サービスと Job に設定済みのものがそのまま使われる。認証は Workload Identity 連携（鍵ファイルは作らない・置かない）。同時に 2 つは動かず（`concurrency`）、実行中のデプロイは取り消さない。

#### 初回設定（デプロイ用サービスアカウントと Workload Identity 連携）

GCP 側と GitHub 側を 1 回だけ設定する。`gcloud` の作業はプロジェクト `yothio-rails-cloud-run`（他アプリと共有）に対して行うので、実行前に `gcloud config get-value project` で確かめる。`<...>` は置き換える。

1. プロジェクト番号（以降の `<PROJECT_NUMBER>`）とリポジトリの数値 ID（以降の `<REPOSITORY_ID>`）を取得する:

   ```
   gcloud projects describe yothio-rails-cloud-run --format="value(projectNumber)"
   ```

   ```
   gh api repos/yothio/Makunouchi --jq .id
   ```

2. デプロイ用サービスアカウントを作る:

   ```
   gcloud iam service-accounts create makunouchi-github-deploy --project yothio-rails-cloud-run --display-name "makunouchi GitHub Actions deploy"
   ```

3. 権限を付ける（最小限。**プロジェクト全体には何も付けない**。すべてリソース単位で付けられるため、プロジェクト単位の付与は不要な想定）:

   - Artifact Registry の `makunouchi` リポジトリへの書き込み（push）:

     ```
     gcloud artifacts repositories add-iam-policy-binding makunouchi --project yothio-rails-cloud-run --location asia-northeast1 --member "serviceAccount:makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com" --role roles/artifactregistry.writer
     ```

   - Cloud Run サービス `makunouchi-admin` の更新（デプロイ）:

     ```
     gcloud run services add-iam-policy-binding makunouchi-admin --project yothio-rails-cloud-run --region asia-northeast1 --member "serviceAccount:makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - Cloud Run Job `makunouchi-admin-migrate` の更新と実行（実行の完了待ちに実行結果の参照も要るが、`roles/run.developer` に含まれる）:

     ```
     gcloud run jobs add-iam-policy-binding makunouchi-admin-migrate --project yothio-rails-cloud-run --region asia-northeast1 --member "serviceAccount:makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - 実行用サービスアカウント `makunouchi-admin-run` を使う権限（サービスと Job のリビジョンがこのアカウントで動くため、更新時に必要）。このアカウント 1 つに対してだけ付ける:

     ```
     gcloud iam service-accounts add-iam-policy-binding makunouchi-admin-run@yothio-rails-cloud-run.iam.gserviceaccount.com --project yothio-rails-cloud-run --member "serviceAccount:makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com" --role roles/iam.serviceAccountUser
     ```

   実際に流して `PERMISSION_DENIED` が出たら、出た権限名を見て足す（このコマンド群を実環境で通したわけではない）。

4. Workload Identity プールを作る:

   ```
   gcloud iam workload-identity-pools create makunouchi-github --project yothio-rails-cloud-run --location global --display-name "makunouchi GitHub"
   ```

5. プロバイダを作る。`attribute-condition` で **リポジトリ `yothio/Makunouchi`（名前と数値 ID の両方）の `main` ブランチ、かつ environment `production`** のときだけ使えるようにする（他のリポジトリ・ブランチ・PR・environment を書かないワークフローからのトークンは、このプロバイダの時点で拒否される。`repository_id` は、リポジトリを改名・削除したあとに同じ名前を別の人が取った場合の対策）:

   ```
   gcloud iam workload-identity-pools providers create-oidc makunouchi-github-actions --project yothio-rails-cloud-run --location global --workload-identity-pool makunouchi-github --issuer-uri "https://token.actions.githubusercontent.com" --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" --attribute-condition "assertion.repository == 'yothio/Makunouchi' && assertion.repository_id == '<REPOSITORY_ID>' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production'"
   ```

   `environment: production` を使うと、トークンの `sub` は `repo:yothio/Makunouchi:environment:production` の形に変わる。ただし principalSet（手順 6）は `attribute.repository` で束ねていて `google.subject` は使わないので、認証は壊れない。`ref` も `refs/heads/main` のまま。

6. そのリポジトリのトークンに、デプロイ用サービスアカウントを借りる権限を付ける:

   ```
   gcloud iam service-accounts add-iam-policy-binding makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com --project yothio-rails-cloud-run --role roles/iam.workloadIdentityUser --member "principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/makunouchi-github/attribute.repository/yothio/Makunouchi"
   ```

7. プロバイダのリソース名を取得する（次の `GCP_WORKLOAD_IDENTITY_PROVIDER` の値。`projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/makunouchi-github/providers/makunouchi-github-actions` の形）:

   ```
   gcloud iam workload-identity-pools providers describe makunouchi-github-actions --project yothio-rails-cloud-run --location global --workload-identity-pool makunouchi-github --format "value(name)"
   ```

8. GitHub のリポジトリ Variables を 2 つ登録する（Settings → Secrets and variables → Actions → Variables、または `gh`）。どちらも秘密ではないので Variables でよい:

   ```
   gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo yothio/Makunouchi --body "<手順 7 の値>"
   gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo yothio/Makunouchi --body "makunouchi-github-deploy@yothio-rails-cloud-run.iam.gserviceaccount.com"
   ```

9. GitHub の environment `production` を作る（Settings → Environments → New environment。または `gh`）:

   ```
   gh api --method PUT repos/yothio/Makunouchi/environments/production
   ```

   作っただけでは保護ルールが無い。次も設定する:

   - **Deployment branches and tags** を「Selected branches and tags」にして `main` だけを許可する（WIF の `ref` 条件と二重に守れる）
   - デプロイ前に承認待ちにしたいときは **Required reviewers** に自分を入れる（承認待ちの間は `concurrency` で後続も待つ）。プライベートリポジトリの無料プランでは使えないことがある

10. **初回は `workflow_dispatch` で手動実行**する（Actions → admin-deploy → Run workflow、ブランチは `main`）。権限不足は初回に出やすい（`gcloud run deploy` と `jobs update` は内部で操作の完了を待つため、`run.operations.get` などが足りるかが実機でしか分からない）。落ちたステップを見れば切り分けられる:
    - 認証のステップで失敗: プロバイダの条件（リポジトリ・ID・ブランチ・environment）、`workloadIdentityUser` の付与、Variables の値
    - docker push で失敗: Artifact Registry の `artifactregistry.writer`
    - `jobs update` / `jobs execute` / `run deploy` で失敗: 出力の `PERMISSION_DENIED` の権限名を見て、該当リソースに足す。`iam.serviceAccountUser` が `makunouchi-admin-run` に付いているかも確かめる

注意:

- プロバイダの条件が `main` 限定なので、main 以外のブランチから `workflow_dispatch` しても認証で失敗する（意図どおり）。
- デプロイ用サービスアカウントは Secret Manager を読まない。Secret の参照はサービスと Job の実行用アカウント（`makunouchi-admin-run`）が行う。
- 本番の進行中（結婚式の当日）に管理画面をデプロイしても live の WebSocket には影響しないが、migrate は開催回の作成に使うテーブルを触りうるので、当日は main へ push しない。

### Active Job（`:async`）について

ジョブは同一プロセス内で動く。Cloud Run のインスタンスが止まった瞬間に未完了ジョブは失われる。自前のジョブは無く、Active Storage の解析・削除程度なので、MVP ではこの欠落を許容する（計画どおり）。重要な処理をジョブに載せるなら別アダプタが要る。

## R2 の設定（コンソール作業）

- **バケット**を作り、オブジェクト読み取りを公開する（カスタムドメインで https）。
- **公開 URL** はカスタムドメイン（https）を `R2_PUBLIC_BASE_URL` に設定する（`r2.dev` は本番向けでない）。live の `imageUrl` は https 必須。
- **CORS**（direct upload 用）:
  - `AllowedOrigins`: 管理画面の本番オリジンのみ（開発用別バケットなら `http://localhost:3000`）
  - `AllowedMethods`: `PUT`
  - `AllowedHeaders`: `Content-Type` / `Content-MD5` / `Content-Disposition`（Rails 8.1 の `headers_for_direct_upload` を実機で確かめてから確定）
  - `MaxAgeSeconds` を付ける
- **aws-sdk-s3**: `config/storage.yml` でチェックサムを `when_required` にしている。実 R2 で画像の analyze / purge が通ることを確かめる。
- Content-Security-Policy を有効にする場合は `connect-src` に R2 エンドポイントを足す（雛形では CSP はコメントアウト）。

## live との結合

- `ADMIN_API_SECRET` は live（`wrangler secret`）と **同じ値**。
- Rails は `LIVE_BASE_URL` へ `PUT /api/sessions/:id`（Bearer）するだけ。`ranking` は呼ばない。
- **実 live への `host` 付き PUT**は、live 側の points/topN 削除と **幹事 ID/PASS ログイン（計画 Task 6）の両方のマージ後**に限る。それより前に送ると、古い live が `host` を捨てて 201 を返し、幹事認証が DO に残らず同じ ID では直せない（管理画面は `host_missing` にする）。
- 投影 URL（`/screen/...`）の表示は split-host-and-screen マージ後（決定 7）。

## ログインとセッション

- セッションは暗号化 cookie。有効期限は**最後に使ってから 8 時間**（使うたびに延びる）。cookie は HTTPS 限定・HttpOnly。
- **ログアウト**でそのユーザーの `users.sessions_valid_after` が更新され、それより前の全セッションが無効になる。
- ログイン試行は IP・メールごとに 3 分 10 回（超えたら 429）。回数はインスタンスごと。
- パスワード再設定機能は無い。忘れたときは管理者が DB で直す。

## 本番前チェックリスト

- [ ] `PORT` を尊重して待ち受けている（Cloud Run が渡す）
- [ ] `config.assume_ssl = true` と `force_ssl`（`/up` は除外）
- [ ] Startup / Liveness probe が `GET /up`
- [ ] Cloud Run **サービス**の `DATABASE_URL` は pooled だけ（direct は Job／手元の migrate 時だけ）
- [ ] デプロイごとに migrate を 1 回だけ流した（CI の migrate Job が成功している。起動時には流していない）
- [ ] 初回 `db:seed` で管理者を作った（`ADMIN_PASSWORD` 12 文字以上）
- [ ] Active Record Encryption の 3 鍵を（ローカルで生成し）Secret に入れ、バックアップした
- [ ] `RAILS_MASTER_KEY` を作成者ローカルの `master.key` から Secret に入れた（リポジトリには無い）
- [ ] R2 の 4 変数 + `R2_PUBLIC_BASE_URL`（https）
- [ ] R2 CORS が管理画面オリジンのみ
- [ ] `ADMIN_API_SECRET` が live と一致（32 文字以上）
- [ ] `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` が正しい（後者未設定だと詳細の URL が空）
- [ ] Task 6 マージ前に本番 live へ `host` 付き PUT をしていない
- [ ] Active Job `:async` のジョブ欠落を許容していることを理解している
- [ ] `master.key` / 各種秘密がリポジトリとログに出ていない

## ユーザーが手で行う初回設定

順番つきの詳細はリポジトリ外の作業メモ（`.scratchpad/task7-user-setup.md`）にもまとめる。概要:

1. Neon（pooled / direct の 2 URL）
2. R2 バケット・https 公開・CORS・API トークン
3. **ローカル開発**で `bin/rails db:encryption:init` → 3 値を Secret へ（production 上では回さない）
4. 作成者ローカルの `config/master.key` を読んで `RAILS_MASTER_KEY` を Secret へ。`ADMIN_API_SECRET`（live と共有）を用意
5. Artifact Registry + Cloud Run サービス（probe = `/up`、サービスの DB は pooled のみ）
6. イメージ push → Secret／環境変数 → Job で migrate（`DATABASE_URL`=direct）→ 初回だけ seed → 動作確認
7. 自動デプロイの設定: デプロイ用サービスアカウント・Workload Identity 連携・GitHub の Variables（2 つ）と environment `production`（上の「GitHub Actions による自動デプロイ」）
8. Task 6 マージ後にリハーサル開催回で実 PUT と幹事ログイン

## 注意

- `config/master.key` はコミットしない（`.gitignore` の `/config/*.key`）。
- `DATABASE_URL`・R2 鍵・`ADMIN_API_SECRET`・幹事パスワードをログに出さない（`filter_parameter_logging` あり）。
- **本番のクイズ進行中に live をデプロイしない**（WebSocket が切れる）。admin のデプロイは進行中ゲストには届かないが、開催回作成中の PUT とはぶつかりうるので式次第では控える。
