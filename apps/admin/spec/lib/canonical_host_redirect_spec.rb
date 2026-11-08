require "rails_helper"
require Rails.root.join("lib/canonical_host_redirect")

RSpec.describe CanonicalHostRedirect do
  let(:canonical_host) { "admin.example.test" }
  let(:inner_app) { ->(_env) { [ 200, { "content-type" => "text/plain" }, [ "ok" ] ] } }
  let(:request) { Rack::MockRequest.new(described_class.new(inner_app, canonical_host)) }
  let(:run_app_host) { "makunouchi-admin-abc123-an.a.run.app" }

  describe "run.app への GET / HEAD" do
    it "独自ドメインの同じパスとクエリへ 302 で飛ばす" do
      response = request.get("/organizer/quiz_sessions?page=2&q=a", "HTTP_HOST" => run_app_host)

      expect(response.status).to eq 302
      expect(response.headers["location"]).to eq "https://admin.example.test/organizer/quiz_sessions?page=2&q=a"
    end

    it "HEAD も 302 で飛ばす" do
      response = request.head("/", "HTTP_HOST" => run_app_host)

      expect(response.status).to eq 302
      expect(response.headers["location"]).to eq "https://admin.example.test/"
    end

    it "ポート付きの Host や大文字の Host でも対象にする" do
      response = request.get("/", "HTTP_HOST" => "#{run_app_host.upcase}:443")

      expect(response.status).to eq 302
    end

    it "リクエストの X-Forwarded-Host に関係なく、飛ばす先は設定したホストだけにする" do
      response = request.get("/", "HTTP_HOST" => run_app_host, "HTTP_X_FORWARDED_HOST" => "evil.example")

      expect(response.headers["location"]).to eq "https://admin.example.test/"
    end

    it "パスが // で始まっても、飛ばす先のホストは変わらない" do
      response = request.get("//evil.example/x", "HTTP_HOST" => run_app_host)

      expect(response.headers["location"]).to start_with "https://admin.example.test/"
    end

    it "末尾ドット付きの Host も対象にする" do
      response = request.get("/", "HTTP_HOST" => "#{run_app_host}.")

      expect(response.status).to eq 302
    end

    it "/up/ と /upload は /up ではないので飛ばす" do
      %w[/up/ /upload /up.json].each do |path|
        expect(request.get(path, "HTTP_HOST" => run_app_host).status).to eq 302
      end
    end

    it "エンコード済みのクエリをそのまま渡す" do
      response = request.get("/search?q=%E3%82%AF%E3%82%A4%E3%82%BA&name=a%20b&empty=", "HTTP_HOST" => run_app_host)

      expect(response.headers["location"]).to eq "https://admin.example.test/search?q=%E3%82%AF%E3%82%A4%E3%82%BA&name=a%20b&empty="
    end

    it "クエリが空の ? だけでも壊さない" do
      response = request.get("/organizer?", "HTTP_HOST" => run_app_host)

      expect(response.status).to eq 302
      expect(response.headers["location"]).to start_with "https://admin.example.test/organizer"
    end
  end

  describe "run.app への GET / HEAD 以外" do
    %w[POST PATCH PUT DELETE].each do |method|
      it "#{method} は 403 にする" do
        response = request.request(method, "/organizer/quiz_sessions", "HTTP_HOST" => run_app_host)

        expect(response.status).to eq 403
        expect(response.headers).not_to have_key "location"
      end
    end
  end

  describe "通す場合" do
    it "run.app の /up は 200 にする" do
      expect(request.get("/up", "HTTP_HOST" => run_app_host).status).to eq 200
    end

    it "run.app の /up は POST や HEAD でも、クエリ付きでも通す" do
      expect(request.post("/up", "HTTP_HOST" => run_app_host).status).to eq 200
      expect(request.head("/up", "HTTP_HOST" => run_app_host).status).to eq 200
      expect(request.get("/up?x=1", "HTTP_HOST" => run_app_host).status).to eq 200
    end

    it "run.app が途中に入るだけの偽装ホストは触らない" do
      %w[run.app.evil.example x.run.app.evil.example evilrun.app].each do |host|
        expect(request.get("/", "HTTP_HOST" => host).status).to eq 200
      end
    end

    it "Host が無いリクエストは触らない" do
      expect(request.get("/").status).to eq 200
    end

    it "独自ドメインは通常どおり通す" do
      expect(request.get("/", "HTTP_HOST" => canonical_host).status).to eq 200
      expect(request.post("/", "HTTP_HOST" => canonical_host).status).to eq 200
    end

    it "localhost や IP の /up は 200 にする" do
      [ "localhost:8080", "127.0.0.1:8080", "169.254.8.129", "[::1]:8080" ].each do |host|
        expect(request.get("/up", "HTTP_HOST" => host).status).to eq 200
      end
    end

    it "run.app 以外の想定外のホストは、/up 以外でもこの仕組みでは触らない" do
      expect(request.get("/", "HTTP_HOST" => "127.0.0.1:8080").status).to eq 200
      expect(request.get("/", "HTTP_HOST" => "evil-run.app.example").status).to eq 200
    end
  end

  describe "設定" do
    it "ホスト名でない値（スキームやパス付き）は起動時に拒否する" do
      [ "https://admin.example.test", "admin.example.test/path", "", "localhost" ].each do |value|
        expect { described_class.new(inner_app, value) }.to raise_error(ArgumentError)
      end
    end
  end
end
