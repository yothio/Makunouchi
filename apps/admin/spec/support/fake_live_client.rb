# live への登録を差し替えるテスト用のクライアント。呼び出しを記録し、決めた結果（または Proc の戻り値）を返す。
class FakeLiveClient
  attr_reader :calls

  def initialize(result = :created)
    @result = result
    @calls = []
  end

  def create_session(session_id, payload)
    @calls << [ session_id, payload.deep_dup ]
    @result.is_a?(Proc) ? @result.call(session_id, payload) : @result
  end
end
