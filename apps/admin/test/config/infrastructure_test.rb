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

  # storage.yml が Rails.root / Rails.env を ERB で参照するので、Rails を起動せずに最小限だけ用意する。
  unless defined?(Rails)
    module ::Rails
      def self.root = Pathname.new(File.expand_path("../..", __dir__))

      def self.env = "test"
    end
  end

  def yaml(path)
    body = read(path).lines.reject { |line| line.start_with?("#") }.join
    YAML.safe_load(ERB.new(body).result, aliases: true)
  end

  test "データベースは PostgreSQL の primary 1 つだけ" do
    config = yaml("config/database.yml")

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
    assert_match(/ENV\.fetch\("PORT", 8080\)/, read("config/puma.rb"))
    dockerfile = read("Dockerfile")
    assert_match(/EXPOSE 8080/, dockerfile)
    refute_match(/EXPOSE 80\b|EXPOSE 3000/, dockerfile)
  end

  test "action_mailbox と action_text は使わない" do
    application = read("config/application.rb")

    refute_match(/^require "action_mailbox\/engine"/, application)
    refute_match(/^require "action_text\/engine"/, application)
  end

  test "Active Storage の本番は R2（S3 互換）で、チェックサムは when_required" do
    storage = yaml("config/storage.yml")
    r2 = storage.fetch("r2")

    assert_equal "S3", r2.fetch("service")
    assert_equal "auto", r2.fetch("region")
    assert_match(/r2\.cloudflarestorage\.com/, r2.fetch("endpoint").to_s)
    assert_equal "when_required", r2.fetch("request_checksum_calculation")
    assert_equal "when_required", r2.fetch("response_checksum_validation")
    assert_match(/config\.active_storage\.service = :r2/, read("config/environments/production.rb"))
    assert_match(/config\.active_storage\.service = :local/, read("config/environments/development.rb"))
  end

  test "master.key とシークレットを追跡しない" do
    assert_match(%r{^/config/\*\.key$}, read(".gitignore"))
  end
end
