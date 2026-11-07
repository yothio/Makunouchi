require "test_helper"

class LiveClientTest < ActiveSupport::TestCase
  PAYLOAD = { title: "本番", questions: [], host: { loginId: "abc", passwordHash: "h" } }.freeze

  test "201 で host: true なら :created" do
    client = LiveClient.new(requester: ->(*) { [ 201, { "ok" => true, "host" => true } ] })

    assert_equal :created, client.create_session("sess-1", PAYLOAD)
  end

  test "201 で host: true が無いと :host_not_registered（再試行しない専用結果）" do
    client = LiveClient.new(requester: ->(*) { [ 201, { "ok" => true } ] })

    assert_equal :host_not_registered, client.create_session("sess-1", PAYLOAD)
  end

  test "409 は :exists" do
    client = LiveClient.new(requester: ->(*) { [ 409, { "error" => "exists" } ] })

    assert_equal :exists, client.create_session("sess-1", PAYLOAD)
  end

  test "422 は :invalid_payload" do
    client = LiveClient.new(requester: ->(*) { [ 422, { "error" => "invalid_payload" } ] })

    assert_equal :invalid_payload, client.create_session("sess-1", PAYLOAD)
  end

  test "400 invalid_session_id は :invalid_session_id" do
    client = LiveClient.new(requester: ->(*) { [ 400, { "error" => "invalid_session_id" } ] })

    assert_equal :invalid_session_id, client.create_session("bad id", PAYLOAD)
  end

  test "401 は :unauthorized" do
    client = LiveClient.new(requester: ->(*) { [ 401, { "error" => "unauthorized" } ] })

    assert_equal :unauthorized, client.create_session("sess-1", PAYLOAD)
  end

  test "ネットワーク失敗や想定外の応答は :error" do
    client = LiveClient.new(requester: ->(*) { raise Errno::ECONNREFUSED })

    assert_equal :error, client.create_session("sess-1", PAYLOAD)

    client = LiveClient.new(requester: ->(*) { [ 500, { "error" => "boom" } ] })
    assert_equal :error, client.create_session("sess-1", PAYLOAD)
  end

  test "LIVE_BASE_URL や ADMIN_API_SECRET 欠落は :misconfigured（再試行しない設定ミス）" do
    original_base = ENV["LIVE_BASE_URL"]
    original_secret = ENV["ADMIN_API_SECRET"]
    ENV.delete("LIVE_BASE_URL")
    ENV.delete("ADMIN_API_SECRET")

    assert_equal :misconfigured, LiveClient.new.create_session("sess-1", PAYLOAD)
  ensure
    ENV["LIVE_BASE_URL"] = original_base
    ENV["ADMIN_API_SECRET"] = original_secret
  end

  test "タイムアウト定数は同期再試行 3 回でもリクエストを長く止めすぎない値" do
    assert_equal 3, LiveClient::OPEN_TIMEOUT
    assert_equal 5, LiveClient::READ_TIMEOUT
  end

  test "PUT は Bearer と JSON を付け、ranking は呼ばない" do

    calls = []
    client = LiveClient.new(
      base_url: "https://live.example.com",
      secret: "test-admin-api-secret-32chars!!",
      requester: ->(method, url, headers, body) {
        calls << [ method, url, headers, body ]
        [ 201, { "ok" => true, "host" => true } ]
      }
    )

    client.create_session("sess-1", PAYLOAD)

    assert_equal 1, calls.size
    method, url, headers, body = calls.first
    assert_equal :put, method
    assert_equal "https://live.example.com/api/sessions/sess-1", url
    assert_equal "Bearer test-admin-api-secret-32chars!!", headers["Authorization"]
    assert_equal "application/json", headers["Content-Type"]
    assert_equal PAYLOAD, body
    assert_no_match(/ranking/, url)
  end
end
