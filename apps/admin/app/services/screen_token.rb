# 投影画面のトークン: HMAC-SHA256(ADMIN_API_SECRET, "screen:" + sessionId) の hex（apps/live の screenTokenFor と同じ式）。
module ScreenToken
  def self.screen(secret, session_id)
    OpenSSL::HMAC.hexdigest("SHA256", secret, "screen:#{session_id}")
  end
end
