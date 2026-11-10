module Live
  # apps/live の screenTokenFor と同じ HMAC（"screen:" + sessionId）。
  module ScreenToken
    def self.screen(secret, session_id)
      OpenSSL::HMAC.hexdigest("SHA256", secret, "screen:#{session_id}")
    end
  end
end
