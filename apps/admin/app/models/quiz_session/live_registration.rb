# host_missing は終端（PUT しない・409 でも昇格しない）。
# :error だけ同一 payload で最大 MAX_ATTEMPTS 回（設定ミス・画像 URL 不正は再試行しない）。
module QuizSession::LiveRegistration
  extend ActiveSupport::Concern

  MAX_ATTEMPTS = 3

  included do
    # live_client_factory はテストで Live::Client の代替を差し込む。
    cattr_accessor :live_client_factory
  end

  def register_with_live(client: nil, payload_builder: QuizSession::LivePayload)
    client ||= self.class.live_client_factory&.call || Live::Client.new
    return :host_missing if host_missing?
    return :ready if ready?

    payload = payload_builder.call(self)
    result = put_live_session_with_retries(client, payload)
    apply_live_registration_result(result)
  rescue QuizSession::LivePayload::InsecureImageUrl
    :insecure_image_url
  end

  private

  def put_live_session_with_retries(client, payload)
    attempts = 0
    result = nil
    while attempts < MAX_ATTEMPTS
      attempts += 1
      result = client.create_session(public_id, payload)
      # 一時障害だけ自動再試行。:misconfigured などはすぐ返す。
      break if result != :error
    end
    result
  end

  def apply_live_registration_result(result)
    case result
    when :created, :exists
      ready!
      :ready
    when :host_not_registered
      host_missing!
      :host_missing
    else
      result
    end
  end
end
