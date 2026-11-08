# pending の開催回を live に PUT し、応答に応じて status を更新する。
# host_missing は終端（PUT しない・409 でも昇格しない）。
# :error だけ同一 payload で最大 MAX_ATTEMPTS 回（設定ミス・画像 URL 不正は再試行しない）。
class QuizSessionRegistrar
  MAX_ATTEMPTS = 3
  # テストで FakeClient を差し込む用。本番では使わない。
  cattr_accessor :client_factory

  def self.call(session, client: nil, payload_builder: QuizPayloadBuilder)
    client ||= client_factory&.call || LiveClient.new
    new(session, client: client, payload_builder: payload_builder).call
  end

  def initialize(session, client:, payload_builder:)
    @session = session
    @client = client
    @payload_builder = payload_builder
  end

  def call
    return :host_missing if @session.host_missing?
    return :ready if @session.ready?

    payload = @payload_builder.call(@session)
    result = put_with_retries(payload)
    apply(result)
  rescue QuizPayloadBuilder::InsecureImageUrl
    :insecure_image_url
  end

  private

  def put_with_retries(payload)
    attempts = 0
    result = nil
    while attempts < MAX_ATTEMPTS
      attempts += 1
      result = @client.create_session(@session.public_id, payload)
      # 一時障害だけ自動再試行。:misconfigured などはすぐ返す。
      break if result != :error
    end
    result
  end

  def apply(result)
    case result
    when :created, :exists
      @session.ready!
      :ready
    when :host_not_registered
      @session.host_missing!
      :host_missing
    else
      result
    end
  end
end
