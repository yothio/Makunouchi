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
   - 実行用サービスアカウントはサービスと同じ `<RUN_SERVICE_ACCOUNT_NAME>`（別のアカウントにするなら、そちらにも `iam.serviceAccountUser` が要る）
   - **自動再実行はしない**: `--max-retries=0`（既定は 3 で、途中まで進んだ migrate が自動で繰り返される）。あわせて `--tasks=1`（既定どおり）と `--task-timeout=10m`（既定どおり。長い migrate を出すときだけ延ばす）を明記する

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

## 4. GitHub Actions によるデプロイ

admin の本番デプロイは release タグ `app-YYYYMMDD-HHMM`（例: `app-20261109-1530`）をきっかけにします。日時は日本時間でタグを作る時刻です。`main` への push では動きません。

流れは次のとおりです。

1. `.github/workflows/release.yml` を `main` から手動起動する（対象 `app`）
2. 日本時間の現在時刻からタグ名を決める（同じ名前のタグが既にあれば止める）
3. `main` の先頭にタグを打ち、GitHub Release を作る
4. 同じ実行から `admin-deploy.yml` を `workflow_call` で呼ぶ（`GITHUB_TOKEN` で打ったタグの push は他ワークフローを起動しないため、PAT は使わず直接呼ぶ）

`admin-deploy.yml` は次を順に流します。どこかで失敗したら以降は動きません（rspec / rubocop が失敗したらイメージは出さず、migrate が失敗したらサービスはデプロイされません）。

1. タグのコミットが `main` に含まれることを確かめる
2. そのタグで `admin-test.yml`（rspec）と `admin-lint.yml`（rubocop）を `workflow_call` で流す
3. `apps/admin` のイメージを `linux/amd64` でビルドし、タグを git の SHA にして Artifact Registry（`<AR_REPOSITORY>/admin`）へ push
4. `<MIGRATE_JOB>` のイメージをその SHA に更新し、実行して完了を待つ
5. `<SERVICE_NAME>` を同じイメージでデプロイ

手で `app-YYYYMMDD-HHMM` タグを push した場合も `admin-deploy.yml` が動きます。release 経路（`workflow_call`）と二重にはなりません。

**運用ルール**: **main は PR 経由でのみ更新**し（直接 push しない）、`admin-test.yml` と `admin-lint` と `test` を required check にして、通ったものだけをマージしてください。デプロイ時にも同じ rspec / rubocop をタグのコミットで流します。



CI が変えるのはイメージだけです。環境変数・Secret・Job の args・probe は、サービスと Job に設定済みのものがそのまま使われます。認証は Workload Identity 連携（鍵ファイルは作らない）。同時に 2 つは動かず（`concurrency`）、実行中のデプロイは取り消しません。

### 4.1 デプロイ用サービスアカウントと Workload Identity

**目的**: GitHub Actions が鍵なしで Artifact Registry と Cloud Run を更新できるようにする。

`gcloud` の作業はプロジェクト `<PROJECT_ID>`（他アプリと共有することがある）に対して行います。実行前に `gcloud config get-value project` で確かめてください。

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

3. 権限を付ける（最小限。プロジェクト全体には付けない。リソース単位で付けられるため、プロジェクト単位の付与は不要な想定）:

   - Artifact Registry の `<AR_REPOSITORY>` への書き込み:

     ```
     gcloud artifacts repositories add-iam-policy-binding <AR_REPOSITORY> --project <PROJECT_ID> --location <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/artifactregistry.writer
     ```

   - Cloud Run サービス `<SERVICE_NAME>` の更新:

     ```
     gcloud run services add-iam-policy-binding <SERVICE_NAME> --project <PROJECT_ID> --region <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - Cloud Run Job `<MIGRATE_JOB>` の更新と実行（実行の完了待ちに実行結果の参照も要るが、`roles/run.developer` に含まれる）:

     ```
     gcloud run jobs add-iam-policy-binding <MIGRATE_JOB> --project <PROJECT_ID> --region <REGION> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/run.developer
     ```

   - 実行用サービスアカウント `<RUN_SERVICE_ACCOUNT_NAME>` を使う権限（サービスと Job のリビジョンがこのアカウントで動くため、更新時に必要）。このアカウント 1 つに対してだけ付ける。別のアカウントにするなら、そちらにも `iam.serviceAccountUser` が要る:

     ```
     gcloud iam service-accounts add-iam-policy-binding <RUN_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com --project <PROJECT_ID> --member "serviceAccount:<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" --role roles/iam.serviceAccountUser
     ```

   実際に流して `PERMISSION_DENIED` が出たら、出た権限名を見て足す（このコマンド群を実環境で通したわけではない）。

4. Workload Identity プールを作る:

   ```
   gcloud iam workload-identity-pools create <POOL_ID> --project <PROJECT_ID> --location global --display-name "GitHub"
   ```

5. プロバイダを作る。`attribute-condition` で **リポジトリ `<OWNER>/<REPO>`（名前と数値 ID の両方）の `main`、かつ environment `production`** のときだけ使えるようにする（他のリポジトリ・ブランチ・PR・environment を書かないワークフローからのトークンは、このプロバイダの時点で拒否される。`repository_id` は、リポジトリを改名・削除したあとに同じ名前を別の人が取った場合の対策）:

   ```
   gcloud iam workload-identity-pools providers create-oidc <PROVIDER_ID> --project <PROJECT_ID> --location global --workload-identity-pool <POOL_ID> --issuer-uri "https://token.actions.githubusercontent.com" --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" --attribute-condition "assertion.repository == '<OWNER>/<REPO>' && assertion.repository_id == '<REPOSITORY_ID>' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production'"
   ```

   `environment: production` を使うと、トークンの `sub` は `repo:<OWNER>/<REPO>:environment:production` の形に変わる。ただし手順 6 の principalSet は `attribute.repository` で束ねていて `google.subject` は使わないので、認証は壊れない。`ref` も `refs/heads/main` のまま。

6. そのリポジトリのトークンに、デプロイ用サービスアカウントを借りる権限を付ける:

   ```
   gcloud iam service-accounts add-iam-policy-binding <DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com --project <PROJECT_ID> --role roles/iam.workloadIdentityUser --member "principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/attribute.repository/<OWNER>/<REPO>"
   ```

7. プロバイダのリソース名を取得する（次の `GCP_WORKLOAD_IDENTITY_PROVIDER`。`projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>` の形）:

   ```
   gcloud iam workload-identity-pools providers describe <PROVIDER_ID> --project <PROJECT_ID> --location global --workload-identity-pool <POOL_ID> --format "value(name)"
   ```

8. GitHub の repository secrets を 9 つ登録する（Settings → Secrets and variables → Actions → Repository secrets）。ワークフローには GCP の値を書かず、すべてここから読む（リポジトリを public にしても値が出ない）。名前と中身:

   | secret 名 | 中身 |
   | --- | --- |
   | `GCP_PROJECT_ID` | `<PROJECT_ID>` |
   | `GCP_PROJECT_NUMBER` | `<PROJECT_NUMBER>`（手順 1 の値） |
   | `GCP_REGION` | `<REGION>` |
   | `GCP_ARTIFACT_REGISTRY_HOST` | `<REGION>-docker.pkg.dev` |
   | `GCP_ARTIFACT_IMAGE` | `<REGION>-docker.pkg.dev/<PROJECT_ID>/<AR_REPOSITORY>/admin` |
   | `GCP_CLOUD_RUN_SERVICE` | `<SERVICE_NAME>` |
   | `GCP_MIGRATE_JOB` | `<MIGRATE_JOB>` |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | 手順 7 の値 |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | `<DEPLOY_SERVICE_ACCOUNT_NAME>@<PROJECT_ID>.iam.gserviceaccount.com` |

   値はコマンドに書かず、`gh secret set` の対話入力で貼る。手順 1〜7 の `gcloud` は値を含むため手元のシェルの履歴に残るが、公開されるものではない。履歴に残したくないのは secret の登録だけである。コードブロックごとに 1 つずつ実行し、プロンプトに値を貼る（まとめて貼ると、2 行目以降のコマンドが値として登録される）:

   ```
   gh secret set GCP_PROJECT_ID --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_PROJECT_NUMBER --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_REGION --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_ARTIFACT_REGISTRY_HOST --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_ARTIFACT_IMAGE --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_CLOUD_RUN_SERVICE --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_MIGRATE_JOB --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo <OWNER>/<REPO>
   ```

   ```
   gh secret set GCP_DEPLOY_SERVICE_ACCOUNT --repo <OWNER>/<REPO>
   ```

   **ログのマスクに注意**: secret の値は Actions のログで `***` に伏せられる。値を含む長い文字列の中でも、その部分は伏せられる。伏せられないのは、値を加工して出力した場合（一部だけ取り出す・URL エンコードや base64 にするなど）と、secret に登録していない値（サービスの URL など）。ワークフローでは secret を加工せずそのまま使い、`echo` などで出力しない。公開リポジトリではログも公開される。そこで、gcloud の `run deploy` / `jobs update` / `jobs execute` には `--quiet --no-user-output-enabled` を付けて出力を止め（成否は終了コードで決まる。エラーは出る）、プロジェクト番号は `GCP_PROJECT_NUMBER` として登録しワークフローから参照する。実際に何が出るかは、非公開のうちに初回の `workflow_dispatch` で確かめる。

9. GitHub の environment `production` を作る:

   ```
   gh api --method PUT repos/<OWNER>/<REPO>/environments/production
   ```

   作っただけでは保護ルールが無い。次も設定する:

   - **Deployment branches and tags** を「Selected branches and tags」にする
     - ブランチ: `main`（release.yml からの `workflow_call` は呼び出し元の ref が `main` のままなので、これが必須）
     - タグ: `app-*` と `live-*`（手でタグを push したときのデプロイ用。付けないとタグ起点の実行が environment で止まる）
   - 承認待ちにしたいときは **Required reviewers** を設定する（承認待ちの間は `concurrency` で後続も待つ。プライベート無料プランでは使えないことがある）

10. **タグの ruleset** をリポジトリに作る（Settings → Rules → Rulesets）。`app-*` と `live-*` の作成・更新・削除を、リリース担当だけに限る。誰でもタグを押せないようにする。この文書では設定手順だけ示し、代行では作らない。


11. **初回のデプロイ**は `release.yml` でタグを切るか、既存タグを `admin-deploy.yml` の `workflow_dispatch` に渡して行う（下の「起動のしかた」）。権限不足は初回に出やすい（`gcloud run deploy` と `jobs update` は内部で操作の完了を待つため、`run.operations.get` などが足りるかが実機でしか分からない）。

**確かめること（初回の切り分け）**

- 認証のステップで失敗: プロバイダの条件（リポジトリ・ID・ブランチ・environment）、`workloadIdentityUser` の付与、secrets の値
- docker push で失敗: Artifact Registry の `artifactregistry.writer`
- `jobs update` / `jobs execute` / `run deploy` で失敗: 出力の `PERMISSION_DENIED` の権限名を見て、該当リソースに足す。`iam.serviceAccountUser` が `<RUN_SERVICE_ACCOUNT_NAME>` に付いているかも確かめる

注意:

- プロバイダの条件が `main` 限定なので、release / `workflow_dispatch`（`--ref main`）以外の ref では認証で失敗する（意図どおり）。手で `app-YYYYMMDD-HHMM` を push した経路は `assertion.ref` がタグになるため、現状の WIF 条件では認証できない。手 push を使うならプロバイダ条件に `app-*` / `live-*` のタグ ref を足す（通常のリリースは `workflow_call` なので不要）
- デプロイ用サービスアカウントは Secret Manager を読まない。Secret の参照はサービスと Job の実行用アカウント（`<RUN_SERVICE_ACCOUNT_NAME>`）が行う
- 本番の進行中に管理画面をデプロイしても live の WebSocket には影響しないが、migrate は開催回作成に使うテーブルを触りうるので、当日はリリースしない

### 4.2 起動のしかた

通常のリリース（タグ作成からデプロイまで）:

```
gh workflow run release.yml --repo <OWNER>/<REPO> --ref main -f target=app
```

画面からは Actions → `release` → Run workflow。ブランチは `main`、対象は `app`。

ロールバック（既存の `app-YYYYMMDD-HHMM` を再デプロイ）:

```
gh workflow run admin-deploy.yml --repo <OWNER>/<REPO> --ref main -f tag=app-20261109-1530
```

`app-YYYYMMDD-HHMM` 以外のタグは受け付けない。


### 4.3 ロールバック

前の成功タグを `admin-deploy.yml` の `workflow_dispatch` に渡して再デプロイします。イメージタグはタグが指す git SHA です。スキーマを戻す必要がある破壊的 migration がある場合は、別途 migration の方針（expand/contract）に従います。進行中のゲスト通信は live 側なので切れませんが、admin で作業中なら控えます。

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
