# admin のデプロイ

`apps/admin`（Rails / Cloud Run / Neon / R2）の初回デプロイと、GitHub Actions からのデプロイ手順です。ローカル開発と環境変数の一覧は [apps/admin/README.md](../../apps/admin/README.md) を見てください。

凡例: `<...>` は自分の値に置き換えます。秘密の値はコマンド引数やシェル履歴に書かず、対話入力で渡します。

サービス・Job・Secret の作成は GCP コンソール（または同等の UI）での手作業を前提にします。`gcloud` の例は CI 用の設定と手で migrate を流す場合に載せます。

---

## 1. ユーザーが手で行う初回設定

**目的**: 本番に必要なクラウド資源と秘密を一度そろえる。

1. Neon（pooled / direct の 2 URL）
2. R2 バケット・https 公開・CORS・API トークン（「R2 の設定」節。AllowedOrigins は独自ドメイン）
3. **ローカル開発**で `bin/rails db:encryption:init` → 表示された 3 値を Secret へ（production イメージ上では回さない）
4. 作成者ローカルの `apps/admin/config/master.key` を読んで `RAILS_MASTER_KEY` を Secret へ。`ADMIN_API_SECRET`（live と共有、32 文字以上）を用意
5. Artifact Registry + Cloud Run サービス（probe = `/up`、サービスの `DATABASE_URL` は pooled のみ）。独自ドメインを使うなら `ADMIN_CANONICAL_HOST` も設定する
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
   - 独自ドメインを使うときは `ADMIN_CANONICAL_HOST` も設定する（次の節）
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

### ログの見方

production のログは 1 行 1 件の JSON で標準出力に出ます（`lib/json_log_formatter.rb`）。Cloud Logging はこれを構造化ログとして読み、`severity` を重要度に使います。項目は次のとおりです。

| 項目 | 中身 |
| --- | --- |
| `severity` | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` |
| `message` | ログの本文。バックトレースは改行を含めて 1 件に入る |
| `time` | 出力した時刻（UTC） |
| `request_id` | リクエストごとの ID（`X-Request-Id`）。同じリクエストのログを束ねる |
| `tags` | `request_id` 以外のタグ（Active Job など）があるときだけ |

ログ エクスプローラ（対象の Cloud Run サービスを選んだ状態）での絞り込みの例:

- エラー以上だけ（500 など。404・422 などの想定内の例外は `ERROR` で出さない）: `severity>=ERROR`
- 警告以上だけ（live への登録の失敗も含む）: `severity>=WARNING`
- 1 リクエストのログをまとめて見る: `jsonPayload.request_id="<request_id>"`
- 例外（`Rails.error` に報告されたもの）: `jsonPayload.message=~"Rails.error"`。未処理例外は Rails 標準のログ（`ERROR`、本文に例外クラスとバックトレース）にも別に 1 件出る
- live への登録の失敗: `jsonPayload.message=~"Live::Client|LiveRegistration"`

live への登録（開催回の作成と「もう一度送る」）では次のログが出ます。開催回 ID（`session_id`）で検索すると、1 回の登録の流れを追えます。

| ログ | 重要度 | 意味 |
| --- | --- | --- |
| `[Live::Client] PUT session_id=… status=… result=…` | `WARNING`（409 は `INFO`） | live が 2xx 以外を返した。401 は `ADMIN_API_SECRET` の不一致、422 は問題データの不正、5xx は live 側の障害 |
| `[Live::Client] PUT session_id=… 例外クラス: メッセージ` | `WARNING` | 接続できない・タイムアウト・`LIVE_BASE_URL` などの設定漏れ（`KeyError`） |
| `[QuizSession::LiveRegistration] retrying session_id=… failed_attempt=…` | `WARNING` | 一時的な失敗のため同じ内容で送り直した |
| `[QuizSession::LiveRegistration] finished session_id=… result=…` | 成功（`ready`）は `INFO`、それ以外は `WARNING` | 登録の最終結果。画面の flash と同じ結果 |

ログに幹事のパスワード・パスワードハッシュ・`ADMIN_API_SECRET`・送った問題の内容は出しません。

Cloud Error Reporting がこの JSON の `message` に入ったバックトレースをエラーとして拾うかは、本番で例外を 1 回起こして確かめていません。拾われない場合も、上の `severity>=ERROR` の絞り込みで見つけられます。

---

## 3. Cloud Run の既定ドメインと独自ドメイン

**目的**: 利用者（システム管理者・主催者）のアクセスは独自ドメインだけにし、Cloud Run の既定ドメイン（`https://<SERVICE_NAME>-<...>.run.app`）はヘルスチェックと監視専用にする。

`--no-default-url` や ingress の制限は、監視が既定ドメインを使えなくなるので使わず、アプリ側（`lib/canonical_host_redirect.rb`）で制限します。

- 環境変数 `ADMIN_CANONICAL_HOST` に独自ドメインのホスト名を入れる。Host が `*.run.app` のリクエストのうち、`/up` 以外が対象になる。GET / HEAD は独自ドメインの同じパス・クエリへ 302、それ以外のメソッドは 403
- `/up` はどのホストでも通す。Cloud Run の probe は Host が `*.run.app` でも独自ドメインでもない（`localhost` や IP の）ことがあり、`*.run.app` 以外のホストはこの仕組みでは触らない
- リダイレクト先は環境変数の値だけから作る。リクエストの Host や `X-Forwarded-Host` は使わない
- 監視（稼働時間チェックなど）は既定ドメインの `https://<RUN_APP_HOST>/up` を使う
- セッション cookie は Host ごとに別なので、ログインは独自ドメイン側で行う

設定には `--update-env-vars` を使います。`--set-env-vars` は他の環境変数を全部消してしまうので使いません。

```
gcloud run services update <SERVICE_NAME> --region <REGION> --project <PROJECT_ID> --update-env-vars ADMIN_CANONICAL_HOST=<ADMIN_HOST>
```

戻すときは次を使います。

```
gcloud run services update <SERVICE_NAME> --region <REGION> --project <PROJECT_ID> --remove-env-vars ADMIN_CANONICAL_HOST
```

**確かめること**（`<RUN_APP_HOST>` は既定ドメインのホスト名、`<ADMIN_HOST>` は独自ドメイン）:

```
curl -sI https://<RUN_APP_HOST>/            # 302、location: https://<ADMIN_HOST>/
curl -sI https://<RUN_APP_HOST>/up          # 200
curl -sI https://<ADMIN_HOST>/              # 200（ログイン画面など。/ が 302 なら location がログイン画面）
```

---

## 4. R2 の設定

**目的**: 管理画面からの画像 direct upload と、公開 https URL を使えるようにする。

- **バケット**を作り、オブジェクト読み取りを公開する（カスタムドメインで https）
- **公開 URL** はカスタムドメイン（https）を `R2_PUBLIC_BASE_URL` に設定する（`r2.dev` は本番向けでない）。live の `imageUrl` は https 必須
- **CORS**（direct upload 用）:
  - `AllowedOrigins`: 管理画面の本番オリジン（独自ドメイン `https://<ADMIN_HOST>`）のみ。`ADMIN_CANONICAL_HOST` を設定すると利用者は独自ドメインでしかアップロードしないので、`*.run.app` は入れない（開発用別バケットなら `http://localhost:3000`）
  - `AllowedMethods`: `PUT`
  - `AllowedHeaders`: `Content-Type` / `Content-MD5` / `Content-Disposition`（Rails 8.1 の `headers_for_direct_upload` を実機で確かめてから確定）
  - `MaxAgeSeconds` を付ける
- **aws-sdk-s3**: `config/storage.yml` でチェックサムを `when_required` にしている。実 R2 で画像の analyze / purge が通ることを確かめる
- Content-Security-Policy を有効にする場合は `connect-src` に R2 エンドポイントを足す（雛形では CSP はコメントアウト）

**確かめること**: 管理画面から画像付きの問題を保存でき、公開 URL が https で開ける。

---

## 5. GitHub Actions によるデプロイ

admin の本番デプロイは GitHub Release の公開をきっかけにします。人が触る CI は `release` の `workflow_dispatch`（対象 `app`）だけです。`main` への push では動きません。

流れは次のとおりです。

1. `.github/workflows/release.yml` を `main` から手動起動する（対象 `app`）
2. 日本時間の現在時刻からタグ名 `app-YYYYMMDD-HHMM`（例: `app-20261109-1530`）を決める。同じ名前のタグか Release が既にあれば止める
3. 同じ対象の未公開 Draft があれば消してから、起動時の `main` のコミット SHA を `--target` にした Draft Release を作る（ブランチ名ではなく SHA。公開までに `main` が進んでも、確かめた内容がデプロイされる）
4. GitHub の Releases 画面で Draft の内容を確かめ、公開（Publish）する。公開でタグが作られる
5. `admin-deploy.yml` が `release: published` で動き、タグ名が `app-YYYYMMDD-HHMM` のときだけ進む（`live-*` や prerelease はジョブをスキップする。失敗にはしない）

`GITHUB_TOKEN` が起こすイベントは `workflow_dispatch` と `repository_dispatch` を除き他ワークフローを起動しません。Draft の作成は `GITHUB_TOKEN` で行い、公開は人が行うので、公開後の `release: published` でデプロイが起動します。PAT や GitHub App は使いません。

`admin-deploy.yml` は次を順に流します。どこかで失敗したら以降は動きません（rspec / rubocop が失敗したらイメージは出さず、migrate が失敗したらサービスはデプロイされません）。

1. タグのコミットが `main` に含まれることを確かめる
2. そのタグで `admin-test.yml`（rspec）と `admin-lint.yml`（rubocop）を `workflow_call` で流す
3. `apps/admin` のイメージを `linux/amd64` でビルドし、タグを git の SHA にして Artifact Registry（`<AR_REPOSITORY>/admin`）へ push
4. `<MIGRATE_JOB>` のイメージをその SHA に更新し、実行して完了を待つ
5. `<SERVICE_NAME>` を同じイメージでデプロイ

**運用ルール**: **main は PR 経由でのみ更新**し（直接 push しない）、`admin-test` と `admin-lint` と `test` を required check にして、通ったものだけをマージしてください。デプロイ時にも同じ rspec / rubocop をタグのコミットで流します。

Draft を公開するとタグが付き、そのあとデプロイ前の rspec / rubocop が走ります。デプロイが落ちてもタグと Release は残ります。直したら新しい Draft を作り直して公開してください（同名タグは作れません）。

CI が変えるのはイメージだけです。環境変数・Secret・Job の args・probe は、サービスと Job に設定済みのものがそのまま使われます。認証は Workload Identity 連携（鍵ファイルは作らない）。同時に 2 つは動かず（`concurrency`）、実行中のデプロイは取り消しません。

### 5.1 デプロイ用サービスアカウントと Workload Identity

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

5. プロバイダを作る。`attribute-condition` で **リポジトリ `<OWNER>/<REPO>`（名前と数値 ID の両方）の `app-*` / `live-*` タグ、かつ environment `production`** のときだけ使えるようにする（他のリポジトリ・ブランチ・PR・environment を書かないワークフローからのトークンは、このプロバイダの時点で拒否される。`repository_id` は、リポジトリを改名・削除したあとに同じ名前を別の人が取った場合の対策）。`release: published` のときの ref はタグになる:

   ```
   gcloud iam workload-identity-pools providers create-oidc <PROVIDER_ID> --project <PROJECT_ID> --location global --workload-identity-pool <POOL_ID> --issuer-uri "https://token.actions.githubusercontent.com" --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" --attribute-condition "assertion.repository == '<OWNER>/<REPO>' && assertion.repository_id == '<REPOSITORY_ID>' && assertion.environment == 'production' && (assertion.ref.startsWith('refs/tags/app-') || assertion.ref.startsWith('refs/tags/live-'))"
   ```

   `environment: production` を使うと、トークンの `sub` は `repo:<OWNER>/<REPO>:environment:production` の形に変わる。ただし手順 6 の principalSet は `attribute.repository` で束ねていて `google.subject` は使わないので、認証は壊れない。

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

   **ログのマスクに注意**: secret の値は Actions のログで `***` に伏せられる。値を含む長い文字列の中でも、その部分は伏せられる。伏せられないのは、値を加工して出力した場合（一部だけ取り出す・URL エンコードや base64 にするなど）と、secret に登録していない値（サービスの URL など）。ワークフローでは secret を加工せずそのまま使い、`echo` などで出力しない。公開リポジトリではログも公開される。そこで、gcloud の `run deploy` / `jobs update` / `jobs execute` には `--quiet --no-user-output-enabled` を付けて出力を止め（成否は終了コードで決まる。エラーは出る）、プロジェクト番号は `GCP_PROJECT_NUMBER` として登録しワークフローから参照する。実際に何が出るかは、非公開のうちに初回のリリース公開で確かめる。

9. GitHub の environment `production` を作る:

   ```
   gh api --method PUT repos/<OWNER>/<REPO>/environments/production
   ```

   作っただけでは保護ルールが無い。次も設定する:

   - **Deployment branches and tags** を「Selected branches and tags」にする
     - タグ: `app-*` と `live-*`（`release: published` のときの ref はタグになる。付けないと environment で止まる。この文書では設定手順だけ示し、代行では変えない）
   - 承認待ちにしたいときは **Required reviewers** を設定する（承認待ちの間は `concurrency` で後続も待つ。プライベート無料プランでは使えないことがある）

10. **タグの ruleset** をリポジトリに作る（Settings → Rules → Rulesets）。`app-*` と `live-*` の作成・更新・削除を、リリース担当だけに限る。Release の公開はリポジトリの書き込み権限がある人ができるので、公開できる人も合わせて限る。この文書では設定手順だけ示し、代行では作らない。

11. **初回のデプロイ**は `release.yml` で Draft を作り、画面で公開して行う（下の「起動のしかた」）。権限不足は初回に出やすい（`gcloud run deploy` と `jobs update` は内部で操作の完了を待つため、`run.operations.get` などが足りるかが実機でしか分からない）。

**確かめること（初回の切り分け）**

- 認証のステップで失敗: プロバイダの条件（リポジトリ・ID・タグ ref・environment）、`workloadIdentityUser` の付与、secrets の値
- docker push で失敗: Artifact Registry の `artifactregistry.writer`
- `jobs update` / `jobs execute` / `run deploy` で失敗: 出力の `PERMISSION_DENIED` の権限名を見て、該当リソースに足す。`iam.serviceAccountUser` が `<RUN_SERVICE_ACCOUNT_NAME>` に付いているかも確かめる

注意:

- プロバイダの条件は `app-*` / `live-*` のタグ ref に合わせる。`main` だけの条件のままだと、公開後のデプロイは認証で失敗する
- デプロイ用サービスアカウントは Secret Manager を読まない。Secret の参照はサービスと Job の実行用アカウント（`<RUN_SERVICE_ACCOUNT_NAME>`）が行う
- 本番の進行中に管理画面をデプロイしても live の WebSocket には影響しないが、migrate は開催回作成に使うテーブルを触りうるので、当日は Draft を公開しない

### 5.2 起動のしかた

通常のリリース（Draft 作成 → 画面で公開 → デプロイ）:

```
gh workflow run release.yml --repo <OWNER>/<REPO> --ref main -f target=app
```

画面からは Actions → `release` → Run workflow。ブランチは `main`、対象は `app`。Draft ができたら Releases で内容を確かめ、Publish release する。

### 5.3 ロールバック

デプロイの手動起動はない。戻したいコミットが `main` の上にあるなら、revert して新しい Draft Release を作り公開する。急ぐときは Cloud Run の以前のリビジョンへトラフィックを切り替えて手で戻す。イメージタグは git の SHA です。スキーマを戻す必要がある破壊的 migration がある場合は、別途 migration の方針（expand/contract）に従います。進行中のゲスト通信は live 側なので切れませんが、admin で作業中なら控えます。

---

## 6. 本番前チェックリスト

- [ ] `PORT` を尊重して待ち受けている（Cloud Run が渡す）
- [ ] `config.assume_ssl = true` と `force_ssl`（`/up` は除外）
- [ ] Startup / Liveness probe が `GET /up`
- [ ] Cloud Run サービスの `DATABASE_URL` は pooled だけ
- [ ] デプロイごとに migrate を 1 回だけ流した（起動時には流していない）
- [ ] 初回 `db:seed` で管理者を作った（`ADMIN_PASSWORD` 12 文字以上）
- [ ] Active Record Encryption の 3 鍵を（ローカルで生成し）Secret に入れ、バックアップした
- [ ] `RAILS_MASTER_KEY` を作成者ローカルの `master.key` から Secret に入れた
- [ ] R2 の 4 変数 + `R2_PUBLIC_BASE_URL`（https）
- [ ] R2 CORS が独自ドメイン（`https://<ADMIN_HOST>`）のみ（`*.run.app` は入れない）
- [ ] 独自ドメインを使うなら `ADMIN_CANONICAL_HOST` を設定し、監視は既定ドメインの `/up` を使う
- [ ] `ADMIN_API_SECRET` が live と一致（32 文字以上）
- [ ] `LIVE_BASE_URL` / `LIVE_PUBLIC_URL` が正しい
- [ ] Active Job `:async` のジョブ欠落を許容していることを理解している
- [ ] `master.key` / 各種秘密がリポジトリとログに出ていない
