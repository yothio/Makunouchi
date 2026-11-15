require "rails_helper"

RSpec.describe QuizSession::LiveRegistration do
  let(:fake_client_class) do
    Class.new do
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
  end

  it "201 host:true 相当の :created で ready になる" do
    session = create(:quiz_session)
    client = fake_client_class.new(:created)

    expect(session.register_with_live(client: client)).to eq :ready
    expect(session.reload).to be_ready
    expect(client.calls.size).to eq 1
    expect(client.calls.first[0]).to eq session.public_id
    expect(client.calls.first[1].dig(:host, :passwordHash)).to eq session.host_password_hash
  end

  it ":host_not_registered は host_missing にして再試行しない" do
    session = create(:quiz_session)
    client = fake_client_class.new(:host_not_registered)

    expect(session.register_with_live(client: client)).to eq :host_missing
    expect(session.reload).to be_host_missing
    expect(client.calls.size).to eq 1
  end

  it "host_missing の開催回は PUT しない" do
    session = create(:quiz_session, :host_missing)
    client = fake_client_class.new(:created)

    expect(session.register_with_live(client: client)).to eq :host_missing
    expect(client.calls).to be_empty
    expect(session.reload).to be_host_missing
  end

  it "一時失敗のあと成功したら同一 public_id で再 PUT して ready" do
    session = create(:quiz_session)
    client = fake_client_class.new(:error, :created)

    expect(session.register_with_live(client: client)).to eq :ready
    expect(session.reload).to be_ready
    expect(client.calls.map(&:first)).to eq [ session.public_id, session.public_id ]
  end

  it ":exists（409）は pending から ready に昇格する" do
    session = create(:quiz_session)
    client = fake_client_class.new(:exists)

    expect(session.register_with_live(client: client)).to eq :ready
    expect(session.reload).to be_ready
  end

  it "host_missing では 409 相当でも昇格しない（PUT 自体しない）" do
    session = create(:quiz_session, :host_missing)
    client = fake_client_class.new(:exists)

    expect(session.register_with_live(client: client)).to eq :host_missing
    expect(client.calls).to be_empty
    expect(session.reload).to be_host_missing
  end

  it "422/401 は pending のまま失敗を返す" do
    session = create(:quiz_session)
    client = fake_client_class.new(:invalid_payload)

    expect(session.register_with_live(client: client)).to eq :invalid_payload
    expect(session.reload).to be_pending

    session2 = create(:quiz_session)
    client2 = fake_client_class.new(:unauthorized)
    expect(session2.register_with_live(client: client2)).to eq :unauthorized
    expect(session2.reload).to be_pending
  end

  it "一時失敗が 3 回続くと pending のまま呼び出しは 3 回" do
    session = create(:quiz_session)
    client = fake_client_class.new(:error, :error, :error)

    expect(session.register_with_live(client: client)).to eq :error
    expect(session.reload).to be_pending
    expect(client.calls.size).to eq 3
  end

  it ":misconfigured は再試行せず pending のまま返す" do
    session = create(:quiz_session)
    client = fake_client_class.new(:misconfigured, :created)

    expect(session.register_with_live(client: client)).to eq :misconfigured
    expect(session.reload).to be_pending
    expect(client.calls.size).to eq 1
  end

  it "InsecureImageUrl は pending のまま :insecure_image_url を返す" do
    session = create(:quiz_session)
    client = fake_client_class.new(:created)
    builder = Class.new do
      def self.call(*)
        raise QuizSession::LivePayload::InsecureImageUrl, "http://"
      end
    end

    expect(session.register_with_live(client: client, payload_builder: builder)).to eq :insecure_image_url
    expect(session.reload).to be_pending
    expect(client.calls).to be_empty
  end

  describe "ログ" do
    before do
      allow(Rails.logger).to receive(:warn)
      allow(Rails.logger).to receive(:info)
    end

    it "再試行ごとに warn、成功の最終結果を info に出す" do
      session = create(:quiz_session)
      client = fake_client_class.new(:error, :error, :created)

      session.register_with_live(client: client)

      expect(Rails.logger).to have_received(:warn).with("[QuizSession::LiveRegistration] retrying session_id=#{session.public_id} failed_attempt=1 result=error")
      expect(Rails.logger).to have_received(:warn).with("[QuizSession::LiveRegistration] retrying session_id=#{session.public_id} failed_attempt=2 result=error")
      expect(Rails.logger).to have_received(:info).with("[QuizSession::LiveRegistration] finished session_id=#{session.public_id} result=ready")
    end

    it "再試行し尽くした失敗は最終結果を warn に出し、3 回目のあとは retrying を出さない" do
      session = create(:quiz_session)
      client = fake_client_class.new(:error, :error, :error)

      session.register_with_live(client: client)

      expect(Rails.logger).to have_received(:warn).with(a_string_including("retrying")).twice
      expect(Rails.logger).to have_received(:warn).with("[QuizSession::LiveRegistration] finished session_id=#{session.public_id} result=error")
      expect(Rails.logger).not_to have_received(:info)
    end

    it "host_missing になったときも warn に出す" do
      session = create(:quiz_session)
      client = fake_client_class.new(:host_not_registered)

      session.register_with_live(client: client)

      expect(Rails.logger).to have_received(:warn).with("[QuizSession::LiveRegistration] finished session_id=#{session.public_id} result=host_missing")
    end
  end
end
