require "rails_helper"
require Rails.root.join("lib/json_log_formatter")

RSpec.describe JsonLogFormatter do
  let(:io) { StringIO.new }
  let(:logger) { ActiveSupport::TaggedLogging.new(ActiveSupport::Logger.new(io, formatter: described_class.new)) }

  def entries
    io.string.lines.map { |line| JSON.parse(line) }
  end

  it "1 行の JSON で severity・message・time を出す" do
    logger.info("こんにちは")

    expect(io.string.lines.size).to eq 1
    entry = entries.first
    expect(entry["severity"]).to eq "INFO"
    expect(entry["message"]).to eq "こんにちは"
    expect { Time.iso8601(entry["time"]) }.not_to raise_error
  end

  it "Cloud Logging の名前に合わせて WARN は WARNING、FATAL は CRITICAL" do
    logger.warn("w")
    logger.fatal("f")
    logger.unknown("u")

    expect(entries.map { |entry| entry["severity"] }).to eq %w[WARNING CRITICAL DEFAULT]
  end

  it "request_id のタグは request_id の項目に出し、メッセージには埋め込まない" do
    logger.tagged("request_id=abc-123", "ActiveJob") { logger.warn("失敗") }

    entry = entries.first
    expect(entry["request_id"]).to eq "abc-123"
    expect(entry["tags"]).to eq [ "ActiveJob" ]
    expect(entry["message"]).to eq "失敗"
  end

  it "複数行のメッセージは改行を含む 1 行の JSON にし、各行の頭のタグも外す" do
    logger.tagged("request_id=abc") do
      logger.fatal([ "RuntimeError (boom):", "app/models/a.rb:1" ].join("\n#{logger.formatter.tags_text}"))
    end

    expect(io.string.lines.size).to eq 1
    expect(entries.first["message"]).to eq "RuntimeError (boom):\napp/models/a.rb:1"
  end

  it "タグが無ければ request_id も tags も出さない" do
    logger.info("x")

    expect(entries.first.keys).to contain_exactly("severity", "message", "time")
  end

  it "例外オブジェクトはクラスとバックトレースを含めて文字列にする" do
    error = RuntimeError.new("boom")
    error.set_backtrace([ "app/models/a.rb:1" ])

    logger.error(error)

    expect(entries.first["message"]).to include("boom (RuntimeError)", "app/models/a.rb:1")
  end

  it "UTF-8 として不正なバイト列があっても例外を投げずに出す" do
    logger.info("bad \xFF bytes".b)

    expect(entries.first["message"]).to start_with("bad ")
  end
end
