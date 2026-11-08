# admin のデプロイ

`apps/admin`（Rails / Cloud Run / Neon / R2）の初回デプロイと、GitHub Actions からのデプロイ手順です。ローカル開発と環境変数の一覧は [apps/admin/README.md](../../apps/admin/README.md) を見てください。

凡例: `<...>` は自分の値に置き換えます。秘密の値はコマンド引数やシェル履歴に書かず、対話入力で渡します。

サービス・Job・Secret の作成は GCP コンソール（または同等の UI）での手作業を前提にします。`gcloud` の例は CI 用の設定と手で migrate を流す場合に載せます。

---

## 1. ユーザーが手で行う初回設定

**目的**: 本番に必要なクラウド資源と秘密を一度そろえる。

1. Neon（pooled / direct の 2 URL）
2. R2 バケット・https 公開・CORS・API トークン（「R2 の設定」節）
3. **ローカル開発**で `bin/rails db:encryption:init` → 表示された 3 値を Secret へ（production イメージ上では回さない）
4. 作成者ローカルの `apps/admin/config/master.key` を読んで `RAILS_MASTER_KEY` を Secret へ。`ADMIN_API_SECRET`（live と共有、32 文字以上）を用意
5. Artifact Registry + Cloud Run サービス（probe = `/up`、サービスの `DATABASE_URL` は pooled のみ）
6. イメージ push → Secret／環境変数 → Job で migrate（`DATABASE_URL` を direct に差し替え）→ 初回だけ seed → 動作確認
7. 自動デプロイの設定（「GitHub Actions」節）: デプロイ用サービスアカウント・Workload Identity・GitHub secrets・environment `production`
8. live 側のデプロイと `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` の設定が終わってから、リハーサル開催回で実 PUT と幹事ログイン（[live.md](live.md)）

---

## 2. Cloud Run へのデプロイ（手作業の要点）

**目的**: イメージをビルドし、サービスと migrate Job を用意する。

1. **イメージをビルド**（`apps/admin` で）:

   ```
   docker build -t admin .
   ```

2. Artifact Registry 等へタグ付けして push し、Cloud Run **サービス**を作成／リビジョン更新する。
3. **サービス設定**:
   - コンテナポート: `8080`（または `PORT` に合わせる）
   - Startup / Liveness probe: HTTP `GET /up`（`force_ssl` は `/up` をリダイレクト除外済み）
   - 環境変数・Secret: README の本番必須項目。**`DATABASE_URL` は pooled だけ**（`DATABASE_URL_DIRECT` はサービスに常設しない）
   - 同時リクエスト数の既定（80）と Puma スレッド 3・DB `max_connections` 5 の前提を変えるときは三つを合わせて見直す
4. **デプロイごとに migrate を 1 回**（Cloud Run **Jobs**）。CI（後述）が自動で流す。Job の設計:
   - Job 名: `<MIGRATE_JOB>`。サービスと **同じコンテナイメージ**（CI が git の SHA タグに差し替える）
   - 環境変数・Secret はサービスと同一にし、Job だけ `DATABASE_URL` を **direct**（`DATABASE_URL_DIRECT` の値）にする。CI は環境変数・Secret を上書きしない
   - args: `./bin/rails,db:migrate`
   - 実行用サービスアカウントはサービスと同じ `<RUN_SERVICE_ACCOUNT_NAME>`
   - **自動再実行はしない**: `--max-retries=0`。あわせて `--tasks=1`、`--task-timeout=10m`

     ```
     gcloud run jobs update <MIGRATE_JOB> --project <PROJECT_ID> --region <REGION> --tasks 1 --max-retries 0 --task-timeout 10m
     ```

   - **破壊的な migration（列の削除・改名など）は 2 段階**（expand → contract）。migrate 成功後にサービスデプロイが失敗すると、旧コードが新しいスキーマで動く期間ができる
   - **手で流す場合**:

     ```
     gcloud run jobs update <MIGRATE_JOB> --project <PROJECT_ID> --region <REGION> --image <REGION>-docker.pkg.dev/<PROJECT_ID>/<AR_REPOSITORY>/admin:<git-sha>
     ```

     ```
     gcloud run jobs execute <MIGRATE_JOB> --project <PROJECT_ID> --region <REGION> --wait
     ```

5. **初回だけ seed**（Job または手元）:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`（12 文字以上）を渡して `bin/rails db:seed`
   - 既にシステム管理者がいれば何もしない（冪等）
6. ブラウザでログインし、問題作成・開催回作成を確認する（live 連携は live の URL・secret 設定後）

コンテナ起動時には `db:prepare` / `db:migrate` を流しません。Neon の pooled 接続はアドバイザリロックと相性が悪く、複数インスタンスが同時に流すと競合するためです。

---

## 3. R2 の設定

**目的**: 管理画面からの画像 direct upload と、公開 https URL を使えるようにする。

- **バケット**を作り、オブジェクト読み取りを公開する（カスタムドメインで https）
- **公開 URL** はカスタムドメイン（https）を `R2_PUBLIC_BASE_URL` に設定する（`r2.dev` は本番向けでない）。live の `imageUrl` は https 必須
- **CORS**（direct upload 用）:
  - `AllowedOrigins`: 管理画面の本番オリジンのみ（開発用別バケットなら `http://localhost:3000`）
  - `AllowedMethods`: `PUT`
  - `AllowedHeaders`: `Content-Type` / `Content-MD5` / `Content-Disposition`（Rails 8.1 の `headers_for_direct_upload` を実機で確かめてから確定）
  - `MaxAgeSeconds` を付ける
- **aws-sdk-s3**: `config/storage.yml` でチェックサムを `when_required` にしている。実 R2 で画像の analyze / purge が通ることを確かめる
- Content-Security-Policy を有効にする場合は `connect-src` に R2 エンドポイントを足す（雛形では CSP はコメントアウト）

**確かめること**: 管理画面から画像付きの問題を保存でき、公開 URL が https で開ける。

---

## 4. GitHub Actions による自動デプロイ

`.github/workflows/admin-deploy.yml` が、main への push（`apps/admin/**` かこのワークフロー自身の変更）と手動実行（`workflow_dispatch`）で次を順に流します。どこかで失敗したら以降は動きません（migrate が失敗したらサービスはデプロイされません）。

1. `apps/admin` のイメージを `linux/amd64` でビルドし、タグを git の SHA にして Artifact Registry（`<AR_REPOSITORY>/admin`）へ push
2. `<MIGRATE_JOB>` のイメージをその SHA に更新し、実行して完了を待つ
3. `<SERVICE_NAME>` を同じイメージでデプロイ

**運用ルール**: このワークフローは main への push で即動き、テストを待ちません。**main は PR 経由でのみ更新**し（直接 push しない）、`admin-test.yml` と `admin-lint` を required check にして、通ったものだけをマージしてください。

CI が変えるのはイメージだけです。環境変数・Secret・Job の args・probe は、サービスと Job に設定済みのものがそのまま使われます。認証は Workload Identity 連携（鍵ファイルは作らない）。同時に 2 つは動かず（`concurrency`）、実行中のデプロイは取り消しません。

### 4.1 デプロイ用サービスアカウントと Workload Identity

**目的**: GitHub Actions が鍵なしで Artifact Registry と Cloud Run を更新できるようにする。

`gcloud` の作業はプロジェクト `<PROJECT_ID>` に対して行います。実行前に `gcloud config get-value project` で確かめてください。

1. プロジェクト番号とリポジトリの数値 ID を取得する:

   ```
   gcloud projects describe <PROJECT_ID> --format="value(projectNumber)"
   ```

   ```
   gh api repos/<OWNER>/<REPO> --jq .id
   ```

2. デプロイ用サービスアカウントを作る:

   ```
   gcloud iam service-accounts create <DEPLOY_SERVICE_ACCOUNT_NAME> --project <PROJECT_ID> --display-name "GitHub Actions deploy"
   ```

3. 権限を付ける（プロジェクト全体には付けない。リソース単位）:

   - Artifact Registry の `<AR_REPOSITORY>` への書き込み:

     ```
     gcloud artifacts repositories add-iam-policy-binding <AR_REPOSITORY> --project <PROJECT_ID> --location <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/artifactregistry.writer
     ```

   - Cloud Run サービス `<SERVICE_NAME>` の更新:

     ```
     gcloud run services add-iam-policy-binding <SERVICE_NAME> --project <PROJECT_ID> --region <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - Cloud Run Job `<MIGRATE_JOB>` の更新と実行:

     ```
     gcloud run jobs add-iam-policy-binding <MIGRATE_JOB> --project <PROJECT_ID> --region <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - 実行用サービスアカウント `<RUN_SERVICE_ACCOUNT_NAME>` を使う権限:

     ```
     gcloud iam service-accounts add-iam-policy-binding <RUN_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com --project <PROJECT_ID> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/iam.serviceAccountUser
     ```

   実際に流して `PERMISSION_DENIED` が出たら、出た権限名を見て足す。

4. Workload Identity プールを作る:

   ```
   gcloud iam workload-identity-pools create <POOL_ID> --project <PROJECT_ID> --location global --display-name "GitHub"
   ```

5. プロバイダを作る。`attribute-condition` で **リポジトリ `<OWNER>/<REPO>`（名前と数値 ID の両方）の `main`、かつ environment `production`** のときだけ使えるようにする:

   ```
   gcloud iam workload-identity-pools providers create-oidc <PROVIDER_ID> --project <PROJECT_ID> --location global --workload-identity-pool <POOL_ID> --issuer-uri "https://token.actions.githubusercontent.com" --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" --attribute-condition "assertion.repository == '<OWNER>/<REPO>' && assertion.repository_id == '<REPOSITORY_ID>' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production'"
   ```

6. そのリポジトリのトークンに、デプロイ用サービスアカウントを借りる権限を付ける:

   ```
   gcloud iam service-accounts add-iam-policy-binding <DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com --project <PROJECT_ID> --role roles/iam.workloadIdentityUser --member "principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/attribute.repository/<OWNER>/<REPO>"
   ```

7. プロバイダのリソース名を取得する（次の `GCP_WORKLOAD_IDENTITY_PROVIDER`）:

   ```
   gcloud iam workload-identity-pools providers describe <PROVIDER_ID> --project <PROJECT_ID> --location global --workload-identity-pool <POOL_ID> --format "value(name)"
   ```

8. GitHub の repository secrets を 9 つ登録する（Settings → Secrets and variables → Actions）。値は `gh secret set` の対話入力で貼り、コマンドに書かない。コードブロックごとに 1 つずつ実行する:

   | secret 名 | 中身 |
   | --- | --- |
   | `GCP_PROJECT_ID` | `<PROJECT_ID>` |
   | `GCP_PROJECT_NUMBER` | `<PROJECT_NUMBER>` |
   | `GCP_REGION` | `<REGION>` |
   | `GCP_ARTIFACT_REGISTRY_HOST` | `<REGION>-docker.pkg.dev` |
   | `GCP_ARTIFACT_IMAGE` | `<REGION>-docker.pkg.dev/<PROJECT_ID>/<AR_REPOSITORY>/admin` |
   | `GCP_CLOUD_RUN_SERVICE` | `<SERVICE_NAME>` |
   | `GCP_MIGRATE_JOB` | `<MIGRATE_JOB>` |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | 手順 7 の値 |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | `<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com` |

   ```
   gh secret set GCP_PROJECT_ID --repo <OWNER>/<REPO>
   ```

   （他の 8 つも同様に 1 つずつ）

   **ログのマスク**: secret の値は Actions のログで伏せられる。加工して出力した部分や、secret 未登録の値（サービスの URL など）は伏せられない。ワークフローでは secret を加工せず、`echo` しない。公開リポジトリではログも公開される。

9. GitHub の environment `production` を作る:

   ```
   gh api --method PUT repos/<OWNER>/<REPO>/environments/production
   ```

   - **Deployment branches and tags** を「Selected branches and tags」にして `main` だけを許可する
   - 承認待ちにしたいときは **Required reviewers** を設定する（プライベート無料プランでは使えないことがある）

10. **初回は `workflow_dispatch` で手動実行**する（Actions → admin-deploy → Run workflow、ブランチは `main`）。

**確かめること（初回の切り分け）**

- 認証のステップで失敗: プロバイダの条件、`workloadIdentityUser`、secrets の値
- docker push で失敗: Artifact Registry の `artifactregistry.writer`
- `jobs update` / `jobs execute` / `run deploy` で失敗: `PERMISSION_DENIED` の権限名と `iam.serviceAccountUser`

注意:

- プロバイダの条件が `main` 限定なので、main 以外から `workflow_dispatch` しても認証で失敗する（意図どおり）
- デプロイ用サービスアカウントは Secret Manager を読まない。参照は実行用アカウント `<RUN_SERVICE_ACCOUNT_NAME>` が行う
- 本番の進行中に管理画面をデプロイしても live の WebSocket には影響しないが、migrate は開催回作成に使うテーブルを触りうるので、当日は main へ push しない

### 4.2 起動のしかた（2 回目以降）

- `main` へ `apps/admin/**`（またはワークフローファイル）の変更をマージすると自動で走る
- 手動:

  ```
  gh workflow run admin-deploy.yml --repo <OWNER>/<REPO> --ref main
  ```

### 4.3 ロールバック

イメージタグ（git SHA）を前の成功分に戻してサービスをデプロイし直します。スキーマを戻す必要がある破壊的 migration がある場合は、別途 migration の方針（expand/contract）に従います。進行中のゲスト通信は live 側なので切れませんが、admin で作業中なら控えます。

---

## 5. 本番前チェックリスト

- [ ] `PORT` を尊重して待ち受けている（Cloud Run が渡す）
- [ ] `config.assume_ssl = true` と `force_ssl`（`/up` は除外）
- [ ] Startup / Liveness probe が `GET /up`
- [ ] Cloud Run サービスの `DATABASE_URL` は pooled だけ
- [ ] デプロイごとに migrate を 1 回だけ流した（起動時には流していない）
- [ ] 初回 `db:seed` で管理者を作った（`ADMIN_PASSWORD` 12 文字以上）
- [ ] Active Record Encryption の 3 鍵を（ローカルで生成し）Secret に入れ、バックアップした
- [ ] `RAILS_MASTER_KEY` を作成者ローカルの `master.key` から Secret に入れた
- [ ] R2 の 4 変数 + `R2_PUBLIC_BASE_URL`（https）
- [ ] R2 CORS が管理画面オリジンのみ
- [ ] `ADMIN_API_SECRET` が live と一致（32 文字以上）
- [ ] `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` が正しい
- [ ] Active Job `:async` のジョブ欠落を許容していることを理解している
- [ ] `master.key` / 各種秘密がリポジトリとログに出ていない
