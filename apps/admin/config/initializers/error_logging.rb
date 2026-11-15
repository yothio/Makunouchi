# Rails.error に報告された例外を 1 件 1 行で出し、Cloud Logging で重要度ごとに絞れるようにする。
# 未処理例外は DebugExceptions も別に出すが、こちらは handled の例外も含め、例外クラスと発生元（source）を同じ形で残す。
class ErrorLogSubscriber
  LEVELS = { error: :error, warning: :warn, info: :info }.freeze

  # context には request や params が入りうるので出さない（filter_parameters を通らない）。
  def report(error, handled:, severity:, source: nil, **)
    lines = [ "[Rails.error] #{error.class}: #{error.message} (handled=#{handled} source=#{source})" ]
    lines.concat(Array(error.backtrace))
    Rails.logger.public_send(LEVELS.fetch(severity, :error), lines.join("\n"))
  end
end

Rails.error.subscribe(ErrorLogSubscriber.new)
