require "net/http"
require "json"

# apps/live の開催回 PUT だけを呼ぶ。ranking は呼ばない。
# host を送ったのに応答に host: true が無いときは :host_not_registered（古い live への保険）。
class LiveClient
  # 同期再試行は最大 3 回。合計の待ちが長くなりすぎないよう短めにする（最悪 roughly 3×(3+5) 秒）。
  OPEN_TIMEOUT = 3
  READ_TIMEOUT = 5

  def initialize(base_url: nil, secret: nil, requester: nil)
    @base_url = base_url
    @secret = secret
    @requester = requester
  end

  def create_session(session_id, payload)
    code, body = put_session(session_id, payload)
    interpret(code, body)
  rescue KeyError => error
    log_failure(error)
    :misconfigured
  rescue StandardError => error
    log_failure(error)
    :error
  end

  private

  def put_session(session_id, payload)
    base_url = (@base_url || (@requester ? "https://live.test" : ENV.fetch("LIVE_BASE_URL"))).to_s.chomp("/")
    secret = @secret || (@requester ? "test-secret" : ENV.fetch("ADMIN_API_SECRET"))
    url = "#{base_url}/api/sessions/#{session_id}"
    headers = {
      "Authorization" => "Bearer #{secret}",
      "Content-Type" => "application/json",
      "Accept" => "application/json"
    }
    return @requester.call(:put, url, headers, payload) if @requester

    uri = URI(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Put.new(uri)
    headers.each { |key, value| request[key] = value }
    request.body = JSON.generate(payload)
    response = http.request(request)
    [ response.code.to_i, parse_json(response.body) ]
  end

  def parse_json(raw)
    JSON.parse(raw.to_s)
  rescue JSON::ParserError
    {}
  end

  def interpret(code, body)
    case code
    when 201
      body.is_a?(Hash) && body["host"] == true ? :created : :host_not_registered
    when 409
      :exists
    when 422
      :invalid_payload
    when 400
      body.is_a?(Hash) && body["error"] == "invalid_session_id" ? :invalid_session_id : :error
    when 401
      :unauthorized
    else
      :error
    end
  end

  def log_failure(error)
    Rails.logger.warn("[LiveClient] #{error.class}: #{error.message}")
  end
end
