require "rails_helper"

RSpec.describe Live::Client do
  let(:payload) { { title: "本番", questions: [], host: { loginId: "abc", passwordHash: "h" } }.freeze }

  it "201 で host: true なら :created" do
    client = Live::Client.new(requester: ->(*) { [ 201, { "ok" => true, "host" => true } ] })

    expect(client.create_session("sess-1", payload)).to eq :created
  end

  it "201 で host: true が無いと :host_not_registered（再試行しない専用結果）" do
    client = Live::Client.new(requester: ->(*) { [ 201, { "ok" => true } ] })

    expect(client.create_session("sess-1", payload)).to eq :host_not_registered
  end

  it "409 は :exists" do
    client = Live::Client.new(requester: ->(*) { [ 409, { "error" => "exists" } ] })

    expect(client.create_session("sess-1", payload)).to eq :exists
  end

  it "422 は :invalid_payload" do
    client = Live::Client.new(requester: ->(*) { [ 422, { "error" => "invalid_payload" } ] })

    expect(client.create_session("sess-1", payload)).to eq :invalid_payload
  end

  it "400 invalid_session_id は :invalid_session_id" do
    client = Live::Client.new(requester: ->(*) { [ 400, { "error" => "invalid_session_id" } ] })

    expect(client.create_session("bad id", payload)).to eq :invalid_session_id
  end

  it "401 は :unauthorized" do
    client = Live::Client.new(requester: ->(*) { [ 401, { "error" => "unauthorized" } ] })

    expect(client.create_session("sess-1", payload)).to eq :unauthorized
  end

  it "ネットワーク失敗や想定外の応答は :error" do
    client = Live::Client.new(requester: ->(*) { raise Errno::ECONNREFUSED })

    expect(client.create_session("sess-1", payload)).to eq :error

    client = Live::Client.new(requester: ->(*) { [ 500, { "error" => "boom" } ] })
    expect(client.create_session("sess-1", payload)).to eq :error
  end

  it "LIVE_BASE_URL や ADMIN_API_SECRET 欠落は :misconfigured（再試行しない設定ミス）" do
    original_base = ENV["LIVE_BASE_URL"]
    original_secret = ENV["ADMIN_API_SECRET"]
    ENV.delete("LIVE_BASE_URL")
    ENV.delete("ADMIN_API_SECRET")

    expect(Live::Client.new.create_session("sess-1", payload)).to eq :misconfigured
  ensure
    ENV["LIVE_BASE_URL"] = original_base
    ENV["ADMIN_API_SECRET"] = original_secret
  end

  it "タイムアウト定数は同期再試行 3 回でもリクエストを長く止めすぎない値" do
    expect(Live::Client::OPEN_TIMEOUT).to eq 3
    expect(Live::Client::READ_TIMEOUT).to eq 5
  end

  it "PUT は Bearer と JSON を付け、ranking は呼ばない" do
    calls = []
    client = Live::Client.new(
      base_url: "https://live.example.com",
      secret: "test-admin-api-secret-32chars!!",
      requester: ->(method, url, headers, body) {
        calls << [ method, url, headers, body ]
        [ 201, { "ok" => true, "host" => true } ]
      }
    )

    client.create_session("sess-1", payload)

    expect(calls.size).to eq 1
    method, url, headers, body = calls.first
    expect(method).to eq :put
    expect(url).to eq "https://live.example.com/api/sessions/sess-1"
    expect(headers["Authorization"]).to eq "Bearer test-admin-api-secret-32chars!!"
    expect(headers["Content-Type"]).to eq "application/json"
    expect(body).to eq payload
    expect(url).not_to match(/ranking/)
  end

  describe "ログ" do
    before do
      allow(Rails.logger).to receive(:warn)
      allow(Rails.logger).to receive(:info)
    end

    it "2xx 以外は status・結果・開催回 ID を warn に出し、秘密と payload は出さない" do
      client = Live::Client.new(secret: "test-admin-api-secret-32chars!!", requester: ->(*) { [ 401, { "error" => "unauthorized" } ] })

      client.create_session("sess-1", payload)

      expect(Rails.logger).to have_received(:warn).with("[Live::Client] PUT session_id=sess-1 status=401 result=unauthorized")
      expect(Rails.logger).to have_received(:warn).once
    end

    it "409 は冪等な応答なので info" do
      client = Live::Client.new(requester: ->(*) { [ 409, { "error" => "exists" } ] })

      client.create_session("sess-1", payload)

      expect(Rails.logger).to have_received(:info).with("[Live::Client] PUT session_id=sess-1 status=409 result=exists")
      expect(Rails.logger).not_to have_received(:warn)
    end

    it "2xx はログに出さない" do
      client = Live::Client.new(requester: ->(*) { [ 201, { "ok" => true, "host" => true } ] })

      client.create_session("sess-1", payload)

      expect(Rails.logger).not_to have_received(:warn)
      expect(Rails.logger).not_to have_received(:info)
    end

    it "例外は開催回 ID と例外クラスを warn に出す" do
      client = Live::Client.new(requester: ->(*) { raise Errno::ECONNREFUSED })

      client.create_session("sess-1", payload)

      expect(Rails.logger).to have_received(:warn).with(a_string_starting_with("[Live::Client] PUT session_id=sess-1 Errno::ECONNREFUSED"))
    end
  end
end
