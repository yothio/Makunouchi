require "json"
require "logger"
require "time"

# Cloud Run（Cloud Logging）は stdout の JSON 1 行を構造化ログとして読み、severity を重要度に使う。
# テキストのままだと全行が既定の重要度になり、WARNING / ERROR で絞れない。
# https://cloud.google.com/run/docs/logging#writing_structured_logs
class JsonLogFormatter < ::Logger::Formatter
  # Cloud Logging の LogSeverity には WARN / FATAL / ANY が無い。
  SEVERITIES = { "WARN" => "WARNING", "FATAL" => "CRITICAL", "ANY" => "DEFAULT" }.freeze
  # production.rb の log_tags が "request_id=<id>" の形でタグを積む。
  # タグの位置では見分けられない（Active Job は別のタグを積む）ので、名前で取り出す。
  REQUEST_ID_TAG = /\Arequest_id=(.+)\z/

  def call(severity, time, _progname, message)
    tags = respond_to?(:current_tags) ? current_tags.map(&:to_s) : []
    entry = {
      severity: SEVERITIES.fetch(severity, severity),
      message: untagged(utf8(msg2str(message)), tags),
      time: time.utc.iso8601(6)
    }
    request_id_tags, other_tags = tags.partition { |tag| REQUEST_ID_TAG.match?(tag) }
    entry[:request_id] = request_id_tags.first[REQUEST_ID_TAG, 1] if request_id_tags.any?
    entry[:tags] = other_tags if other_tags.any?
    "#{JSON.generate(entry)}\n"
  end

  private

  # TaggedLogging は親クラスの call より先に "[tag] " をメッセージへ埋め込み、
  # 複数行（DebugExceptions のバックトレース）では各行の頭にも付ける。タグは別の項目で出すので外す。
  def untagged(text, tags)
    return text if tags.empty? || !respond_to?(:tags_text)

    prefix = utf8(tags_text)
    text.delete_prefix(prefix).gsub("\n#{prefix}", "\n")
  end

  # 不正なバイト列を含むと JSON.generate が例外を投げ、ログ 1 行のためにリクエストが落ちる。
  def utf8(text)
    text.dup.force_encoding(Encoding::UTF_8).scrub
  end
end
