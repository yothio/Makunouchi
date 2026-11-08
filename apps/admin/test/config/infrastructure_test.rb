require "minitest/autorun"
require "pathname"
require "erb"
require "yaml"

# Task 1: 雛形を Neon / Cloud Run / R2 向けに直した結果を、設定ファイルの内容で固定する。
# Rails も DB も起動しない（ファイルを読むだけ）ので、Postgres が無くても流せる。
# 実際の Neon / R2 には繋がない（そちらは実機確認）。
class InfrastructureTest < Minitest::Test
  def self.test(name, &block) = define_method("test_#{name}", &block)

  def root = Pathname.new(File.expand_path("../..", __dir__))

  def read(path) = root.join(path).read

  # storage.yml の ERB が参照する Rails を、環境ごとに差し替えて描画する（本物の Rails は使わない）。
  FakeEnv = Struct.new(:name) do
    def production? = name == "production"

    def to_s = name
  end

  def yaml(path, env_name: "test", env_vars: {})
    fake_rails = Module.new
    fake_rails.define_singleton_method(:root) { Pathname.new(File.expand_path("../..", __dir__)) }
    fake_rails.define_singleton_method(:env) { FakeEnv.new(env_name) }
    sandbox = Module.new
    sandbox.const_set(:Rails, fake_rails)
    sandbox.const_set(:ENV, env_vars)
    body = read(path).lines.reject { |line| line.start_with?("#") }.join
    YAML.safe_load(ERB.new(body).result(sandbox.module_eval("binding")), aliases: true)
  end

  test "データベースは PostgreSQL の primary 1 つだけ" do
    config = yaml("config/database.yml", env_vars: {})

    %w[development test production].each do |env|
      assert_equal "postgresql", config.fetch(env).fetch("adapter"), "#{env} は postgresql"
    end
    refute_includes config.fetch("production").keys, "cache"
    refute_includes config.fetch("production").keys, "queue"
    assert_match(/DATABASE_URL/, read("config/database.yml"))
  end

  test "Gemfile から sqlite3 / kamal / solid_cache / solid_queue を外し pg と aws-sdk-s3 を使う" do
    gemfile = read("Gemfile")

    %w[sqlite3 kamal solid_cache solid_queue].each do |name|
      refute_match(/^\s*gem "#{name}"/, gemfile)
    end
    assert_match(/^gem "pg"/, gemfile)
    assert_match(/^gem "aws-sdk-s3", ">= 1\.178", require: false/, gemfile)
  end

  test "Kamal・ネスト CI・solid 系の設定と schema を残さない" do
    %w[
      config/deploy.yml .kamal .github bin/kamal bin/jobs
      config/cache.yml config/queue.yml config/recurring.yml
      db/cache_schema.rb db/queue_schema.rb
    ].each do |path|
      refute root.join(path).exist?, "#{path} が残っている"
    end
  end

  test "production は memory_store と :async を使い、solid 系の設定を残さない" do
    production = read("config/environments/production.rb")

    assert_match(/config\.cache_store = :memory_store/, production)
    assert_match(/config\.active_job\.queue_adapter = :async/, production)
    refute_match(/solid_cache|solid_queue|connects_to/, production)
    assert_match(/config\.assume_ssl = true/, production)
    refute_match(/solid_queue/, read("config/puma.rb"))
  end

  test "Puma は PORT（既定 8080）で待ち受ける" do
    puma = read("config/puma.rb")
    assert_match(/ENV\.fetch\("PORT"\)/, puma)
    assert_match(/production.*8080|8080.*production/m, puma)
    assert_match(/3000/, puma)
    dockerfile = read("Dockerfile")
    assert_match(/EXPOSE 8080/, dockerfile)
    refute_match(/EXPOSE 80\b|EXPOSE 3000/, dockerfile)
  end

  test "action_mailbox と action_text は使わない" do
    application = read("config/application.rb")

    refute_match(/^require "action_mailbox\/engine"/, application)
    refute_match(/^require "action_text\/engine"/, application)
  end

  R2_VARS = {
    "R2_BUCKET" => "bucket", "R2_ENDPOINT" => "https://abc.r2.cloudflarestorage.com",
    "R2_ACCESS_KEY_ID" => "id", "R2_SECRET_ACCESS_KEY" => "secret"
  }.freeze

  test "Active Storage の本番は R2（S3 互換）で、チェックサムは when_required" do
    r2 = yaml("config/storage.yml", env_name: "production", env_vars: R2_VARS).fetch("r2")

    assert_equal "S3", r2.fetch("service")
    assert_equal "auto", r2.fetch("region")
    assert_equal "https://abc.r2.cloudflarestorage.com", r2.fetch("endpoint")
    assert_equal "when_required", r2.fetch("request_checksum_calculation")
    assert_equal "when_required", r2.fetch("response_checksum_validation")
    assert_match(/config\.active_storage\.service = :r2/, read("config/environments/production.rb"))
    assert_match(/config\.active_storage\.service = :local/, read("config/environments/development.rb"))
  end

  test "本番では R2 の設定が欠けたら黙ってダミーに落ちず、起動で落ちる" do
    R2_VARS.each_key do |name|
      assert_raises(KeyError, "#{name} が無いのに描画できてしまう") do
        yaml("config/storage.yml", env_name: "production", env_vars: R2_VARS.except(name))
      end
    end
  end

  test "開発・テストでは R2 の環境変数が無くても storage.yml を描画できる" do
    assert yaml("config/storage.yml", env_name: "development", env_vars: {}).key?("r2")
  end

  test "production は i18n のフォールバックを上書きしない（Translation missing を出さない）" do
    refute_match(/^\s*config\.i18n\.fallbacks = true/, read("config/environments/production.rb"))
    assert_match(/config\.i18n\.fallbacks = \[ :en \]/, read("config/application.rb"))
  end

  test "development にも Active Record Encryption の開発用の鍵がある（無いと開催回の作成が 500 になる）" do
    development = read("config/environments/development.rb")

    %w[primary_key deterministic_key key_derivation_salt].each do |key|
      assert_match(/encryption\.#{key} = "/, development)
    end
  end

  test "production は Active Record Encryption の鍵を環境変数から必須で読む" do
    production = read("config/environments/production.rb")

    assert_match(/encryption\.primary_key = ENV\.fetch\("ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"\)/, production)
    assert_match(/encryption\.key_derivation_salt = ENV\.fetch\("ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"\)/, production)
    assert_match(/ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=build-dummy/, read("Dockerfile"))
  end

  test "production は force_ssl で /up を除外する" do
    production = read("config/environments/production.rb")

    assert_match(/^\s*config\.force_ssl = true/, production)
    assert_match(/config\.ssl_options = .*\/up/, production)
  end

  test "起動のたびに db:prepare を流さない（マイグレーションは direct 接続で別に流す）" do
    refute_match(/db:(prepare|migrate)/, read("bin/docker-entrypoint"))
    assert_match(/DATABASE_URL_DIRECT/, read("README.md"))
  end

  test "master.key とシークレットを追跡しない" do
    assert_match(%r{^/config/\*\.key$}, read(".gitignore"))
  end
end
