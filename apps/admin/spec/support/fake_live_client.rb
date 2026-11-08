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
