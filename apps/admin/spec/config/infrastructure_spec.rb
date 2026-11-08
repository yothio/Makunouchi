require "pathname"
require "erb"
require "yaml"

# Task 1: 雛形を Neon / Cloud Run / R2 向けに直した結果を、設定ファイルの内容で固定する。
# Rails も DB も起動しない（ファイルを読むだけ）ので、Postgres が無くても流せる。
# そのため rails_helper は読み込まず、spec_helper だけで動く形を保つ。
# 実際の Neon / R2 には繋がない（そちらは実機確認）。
RSpec.describe "インフラ設定" do
  def root = Pathname.new(File.expand_path("../..", __dir__))

  def read(path) = root.join(path).read

  # storage.yml の ERB が参照する Rails を、環境ごとに差し替えて描画する（本物の Rails は使わない）。
  def yaml(path, env_name: "test", env_vars: {})
    app_root = root
    fake_env = Struct.new(:name) do
      def production? = name == "production"

      def to_s = name
    end
    fake_rails = Module.new
    fake_rails.define_singleton_method(:root) { app_root }
    fake_rails.define_singleton_method(:env) { fake_env.new(env_name) }
    sandbox = Module.new
    sandbox.const_set(:Rails, fake_rails)
    sandbox.const_set(:ENV, env_vars)
    body = read(path).lines.reject { |line| line.start_with?("#") }.join
    YAML.safe_load(ERB.new(body).result(sandbox.module_eval("binding")), aliases: true)
  end

  let(:r2_vars) do
    {
      "R2_BUCKET" => "bucket", "R2_ENDPOINT" => "https://abc.r2.cloudflarestorage.com",
      "R2_ACCESS_KEY_ID" => "id", "R2_SECRET_ACCESS_KEY" => "secret"
    }
  end

  it "データベースは PostgreSQL の primary 1 つだけ" do
    config = yaml("config/database.yml", env_vars: {})

    %w[development test production].each do |env|
      expect(config.fetch(env).fetch("adapter")).to eq("postgresql"), "#{env} は postgresql"
    end
    expect(config.fetch("production").keys).not_to include "cache"
    expect(config.fetch("production").keys).not_to include "queue"
    expect(read("config/database.yml")).to match(/DATABASE_URL/)
  end

  it "Gemfile から sqlite3 / kamal / solid_cache / solid_queue を外し pg と aws-sdk-s3 を使う" do
    gemfile = read("Gemfile")

    %w[sqlite3 kamal solid_cache solid_queue].each do |name|
      expect(gemfile).not_to match(/^\s*gem "#{name}"/)
    end
    expect(gemfile).to match(/^gem "pg"/)
    expect(gemfile).to match(/^gem "aws-sdk-s3", ">= 1\.178", require: false/)
  end

  it "Kamal・ネスト CI・solid 系の設定と schema を残さない" do
    %w[
      config/deploy.yml .kamal .github bin/kamal bin/jobs
      config/cache.yml config/queue.yml config/recurring.yml
      db/cache_schema.rb db/queue_schema.rb
    ].each do |path|
      expect(root.join(path).exist?).to be(false), "#{path} が残っている"
    end
  end

  it "production は memory_store と :async を使い、solid 系の設定を残さない" do
    production = read("config/environments/production.rb")

    expect(production).to match(/config\.cache_store = :memory_store/)
    expect(production).to match(/config\.active_job\.queue_adapter = :async/)
    expect(production).not_to match(/solid_cache|solid_queue|connects_to/)
    expect(production).to match(/config\.assume_ssl = true/)
    expect(read("config/puma.rb")).not_to match(/solid_queue/)
  end

  it "Puma は PORT（既定 8080）で待ち受ける" do
    puma = read("config/puma.rb")
    expect(puma).to match(/ENV\.fetch\("PORT"\)/)
    expect(puma).to match(/production.*8080|8080.*production/m)
    expect(puma).to match(/3000/)
    dockerfile = read("Dockerfile")
    expect(dockerfile).to match(/EXPOSE 8080/)
    expect(dockerfile).not_to match(/EXPOSE 80\b|EXPOSE 3000/)
  end

  it "action_mailbox と action_text は使わない" do
    application = read("config/application.rb")

    expect(application).not_to match(/^require "action_mailbox\/engine"/)
    expect(application).not_to match(/^require "action_text\/engine"/)
  end

  it "Active Storage の本番は R2（S3 互換）で、チェックサムは when_required" do
    r2 = yaml("config/storage.yml", env_name: "production", env_vars: r2_vars).fetch("r2")

    expect(r2.fetch("service")).to eq "S3"
    expect(r2.fetch("region")).to eq "auto"
    expect(r2.fetch("endpoint")).to eq "https://abc.r2.cloudflarestorage.com"
    expect(r2.fetch("request_checksum_calculation")).to eq "when_required"
    expect(r2.fetch("response_checksum_validation")).to eq "when_required"
    expect(read("config/environments/production.rb")).to match(/config\.active_storage\.service = :r2/)
    expect(read("config/environments/development.rb")).to match(/config\.active_storage\.service = :local/)
  end

  it "本番では R2 の設定が欠けたら黙ってダミーに落ちず、起動で落ちる" do
    r2_vars.each_key do |name|
      expect {
        yaml("config/storage.yml", env_name: "production", env_vars: r2_vars.except(name))
      }.to raise_error(KeyError), "#{name} が無いのに描画できてしまう"
    end
  end

  it "開発・テストでは R2 の環境変数が無くても storage.yml を描画できる" do
    expect(yaml("config/storage.yml", env_name: "development", env_vars: {}).key?("r2")).to be true
  end

  it "production は i18n のフォールバックを上書きしない（Translation missing を出さない）" do
    expect(read("config/environments/production.rb")).not_to match(/^\s*config\.i18n\.fallbacks = true/)
    expect(read("config/application.rb")).to match(/config\.i18n\.fallbacks = \[ :en \]/)
  end

  it "development にも Active Record Encryption の開発用の鍵がある（無いと開催回の作成が 500 になる）" do
    development = read("config/environments/development.rb")

    %w[primary_key deterministic_key key_derivation_salt].each do |key|
      expect(development).to match(/encryption\.#{key} = "/)
    end
  end

  it "production は Active Record Encryption の鍵を環境変数から必須で読む" do
    production = read("config/environments/production.rb")

    expect(production).to match(/encryption\.primary_key = ENV\.fetch\("ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"\)/)
    expect(production).to match(/encryption\.key_derivation_salt = ENV\.fetch\("ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"\)/)
    expect(read("Dockerfile")).to match(/ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=build-dummy/)
  end

  it "production は force_ssl で /up を除外する" do
    production = read("config/environments/production.rb")

    expect(production).to match(/^\s*config\.force_ssl = true/)
    expect(production).to match(/config\.ssl_options = .*\/up/)
  end

  it "起動のたびに db:prepare を流さない（マイグレーションは direct 接続で別に流す）" do
    expect(read("bin/docker-entrypoint")).not_to match(/db:(prepare|migrate)/)
    expect(read("README.md")).to match(/DATABASE_URL_DIRECT/)
  end

  it "README に Cloud Run 向けの必須項目が書いてある" do
    readme = read("README.md")

    %w[
      ADMIN_API_SECRET LIVE_BASE_URL LIVE_PUBLIC_URL R2_PUBLIC_BASE_URL
      ADMIN_EMAIL ADMIN_PASSWORD assume_ssl /up
    ].each do |needle|
      expect(readme).to match(Regexp.new(Regexp.escape(needle))), "#{needle} が README に無い"
    end
    expect(readme).to match(/Startup|Liveness|probe/i)
    expect(readme).to match(/db:seed/)
    expect(readme).to match(/:async/)
  end

  it "master.key とシークレットを追跡しない" do
    expect(read(".gitignore")).to match(%r{^/config/\*\.key$})
  end
end
