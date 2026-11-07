require "test_helper"

class QuizSessionRegistrarTest < ActiveSupport::TestCase
  class FakeClient
    attr_reader :calls

    def initialize(*results)
      @results = results
      @calls = []
    end

    def create_session(session_id, payload)
      @calls << [ session_id, payload ]
      @results.shift || :error
    end
  end

  def session_for(user = users(:other_organizer))
    user.questions.destroy_all
    5.times do |i|
      user.questions.create!(title: "問題#{i}", choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d", correct_index: i % 4)
    end
    QuizSession.prepare(user: user, title: "本番").tap(&:save!)
  end

  test "201 host:true 相当の :created で ready になる" do
    session = session_for
    client = FakeClient.new(:created)

    assert_equal :ready, QuizSessionRegistrar.call(session, client: client)
    assert session.reload.ready?
    assert_equal 1, client.calls.size
    assert_equal session.public_id, client.calls.first[0]
    assert_equal session.host_password_hash, client.calls.first[1].dig(:host, :passwordHash)
  end

  test ":host_not_registered は host_missing にして再試行しない" do
    session = session_for
    client = FakeClient.new(:host_not_registered)

    assert_equal :host_missing, QuizSessionRegistrar.call(session, client: client)
    assert session.reload.host_missing?
    assert_equal 1, client.calls.size
  end

  test "host_missing の開催回は PUT しない" do
    session = session_for
    session.host_missing!
    client = FakeClient.new(:created)

    assert_equal :host_missing, QuizSessionRegistrar.call(session, client: client)
    assert_empty client.calls
    assert session.reload.host_missing?
  end

  test "一時失敗のあと成功したら同一 public_id で再 PUT して ready" do
    session = session_for
    client = FakeClient.new(:error, :created)

    assert_equal :ready, QuizSessionRegistrar.call(session, client: client)
    assert session.reload.ready?
    assert_equal [ session.public_id, session.public_id ], client.calls.map(&:first)
  end

  test ":exists（409）は pending から ready に昇格する" do
    session = session_for
    client = FakeClient.new(:exists)

    assert_equal :ready, QuizSessionRegistrar.call(session, client: client)
    assert session.reload.ready?
  end

  test "host_missing では 409 相当でも昇格しない（PUT 自体しない）" do
    session = session_for
    session.host_missing!
    client = FakeClient.new(:exists)

    assert_equal :host_missing, QuizSessionRegistrar.call(session, client: client)
    assert_empty client.calls
    assert session.reload.host_missing?
  end

  test "422/401 は pending のまま失敗を返す" do
    session = session_for
    client = FakeClient.new(:invalid_payload)

    assert_equal :invalid_payload, QuizSessionRegistrar.call(session, client: client)
    assert session.reload.pending?

    session2 = session_for(users(:organizer))
    client2 = FakeClient.new(:unauthorized)
    assert_equal :unauthorized, QuizSessionRegistrar.call(session2, client: client2)
    assert session2.reload.pending?
  end
end
