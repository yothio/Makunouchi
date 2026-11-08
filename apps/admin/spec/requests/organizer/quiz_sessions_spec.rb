require "rails_helper"

RSpec.describe Organizer::QuizSessionsController, type: :request do
  before do
    @fake_live = FakeLiveClient.new(:created)
    QuizSessionRegistrar.client_factory = -> { @fake_live }
  end

  after do
    QuizSessionRegistrar.client_factory = nil
  end

  def add_questions(user, count)
    user.questions.destroy_all
    count.times do |i|
      user.questions.create!(title: "問題#{i}", choice_a: "a", choice_b: "b", choice_c: "c", choice_d: "d", correct_index: i % 4)
    end
  end

  it "未ログインはログインへ" do
    get new_organizer_quiz_session_path
    expect(response).to redirect_to(new_session_path)

    post organizer_quiz_sessions_path, params: { quiz_session: { title: "x" } }
    expect(response).to redirect_to(new_session_path)
  end

  it "作成画面は開催回名だけを入力する" do
    sign_in_as users(:organizer)

    get new_organizer_quiz_session_path

    expect(response).to have_http_status(:success)
    assert_select "input[name='quiz_session[title]']"
    assert_select "a[href=?]", root_path
  end

  it "問題が 5 問以上あれば作成でき、live 登録成功で ready になり詳細に幹事の ID/PASS が出る" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user

    expect {
      post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
    }.to change { user.quiz_sessions.count }.by(1)
    created = user.quiz_sessions.order(:id).last
    expect(created).to be_ready
    expect(@fake_live.calls.size).to eq 1
    expect(@fake_live.calls.first[0]).to eq created.public_id
    expect(@fake_live.calls.first[1].dig(:host, :passwordHash)).to eq created.host_password_hash
    expect(@fake_live.calls.first[1].key?(:points)).to be false
    expect(response).to redirect_to(organizer_quiz_session_path(created))
    follow_redirect!

    expect(response).to have_http_status(:success)
    assert_select ".host-login-id", text: created.host_login_id
    assert_select ".host-password", text: created.host_password
    assert_select "li.snapshot-question", 5
    expect(response.body).to match(/問題0/)
    assert_select "a[href=?]", root_path
    assert_select "form.register-again", false
  end

  it "live が host: true を返さないと host_missing になり ready にも register の PUT にも進まない" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user
    @fake_live = FakeLiveClient.new(:host_not_registered)
    QuizSessionRegistrar.client_factory = -> { @fake_live }

    post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
    created = user.quiz_sessions.order(:id).last

    expect(created).to be_host_missing
    expect(@fake_live.calls.size).to eq 1
    follow_redirect!
    expect(response.body).to match(/幹事の認証情報に未対応/)
    assert_select "form.register-again", false

    @fake_live.calls.clear
    post register_organizer_quiz_session_path(created)

    expect(@fake_live.calls).to be_empty
    expect(created.reload).to be_host_missing
  end

  it "pending の開催回はもう一度送るで同じ public_id・同じハッシュを再送する" do
    user = users(:organizer)
    add_questions(user, 5)
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    sign_in_as user
    expect(session).to be_pending

    get organizer_quiz_session_path(session)
    assert_select "form.register-again"

    post register_organizer_quiz_session_path(session)

    expect(session.reload).to be_ready
    expect(@fake_live.calls.size).to eq 1
    expect(@fake_live.calls.first[0]).to eq session.public_id
    expect(@fake_live.calls.first[1].dig(:host, :passwordHash)).to eq session.host_password_hash
  end

  it "詳細に投影画面の URL（screen トークン付き）が出る。秘密そのものは出さない" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user
    original = ENV["ADMIN_API_SECRET"]
    ENV["ADMIN_API_SECRET"] = "t" * 32

    post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
    created = user.quiz_sessions.order(:id).last
    follow_redirect!

    assert_select ".screen-url", text: /\/screen\/#{created.public_id}\?token=#{ScreenToken.screen("t" * 32, created.public_id)}\z/
    expect(response.body).not_to match(/#{"t" * 32}/)

    ENV.delete("ADMIN_API_SECRET")
    get organizer_quiz_session_path(created)
    assert_select ".screen-url", 0
    assert_select ".screen-url-missing"
  ensure
    ENV["ADMIN_API_SECRET"] = original
  end

  it "問題が 4 問や 16 問では作れず、理由を伝える" do
    user = users(:organizer)
    sign_in_as user

    [ 4, 16 ].each do |count|
      add_questions(user, count)
      expect {
        post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
      }.not_to change(QuizSession, :count)
      expect(response).to have_http_status(:unprocessable_content)
      assert_select ".error li", text: /5〜15/
    end
    expect(@fake_live.calls).to be_empty
  end

  it "params の user_id・status・public_id・幹事 ID は受け付けない" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user

    post organizer_quiz_sessions_path, params: { quiz_session: {
      title: "本番", user_id: users(:other_organizer).id, status: "pending", public_id: "mine", host_login_id: "attacker1"
    } }

    created = QuizSession.order(:id).last
    expect(created.user).to eq user
    expect(created).to be_ready
    expect(created.public_id).not_to eq "mine"
    expect(created.host_login_id).not_to eq "attacker1"
  end

  it "他の主催者の開催回は 404" do
    other = users(:other_organizer)
    add_questions(other, 5)
    session = QuizSession.prepare(user: other, title: "他人の").tap(&:save!)
    sign_in_as users(:organizer)

    get organizer_quiz_session_path(session)
    expect(response).to have_http_status(:not_found)

    post register_organizer_quiz_session_path(session)
    expect(response).to have_http_status(:not_found)
  end

  it "幹事パスワードを出す詳細は no-store（戻るボタンやキャッシュに残さない）" do
    user = users(:organizer)
    add_questions(user, 5)
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    sign_in_as user

    get organizer_quiz_session_path(session)

    expect(response.headers["Cache-Control"]).to include "no-store"
  end

  it "作成ボタンは送信中に無効になる（二重送信で開催回が 2 つできないように）" do
    sign_in_as users(:organizer)

    get new_organizer_quiz_session_path

    assert_select "input[type=submit][data-turbo-submits-with]"
  end

  it "トップに開催回の件数と一覧（タイトル）と作成ボタンが出る" do
    user = users(:organizer)
    add_questions(user, 5)
    QuizSession.prepare(user: user, title: "リハーサル").save!
    sign_in_as user

    get root_path

    assert_select ".quiz-session-count", text: /1/
    assert_select "li.quiz-session a", text: "リハーサル"
    assert_select "a[href=?]", new_organizer_quiz_session_path
  end

  it "システム管理者も自分の開催回を作れる（問題が足りなければ作れない）" do
    sign_in_as users(:system_admin)

    expect {
      post organizer_quiz_sessions_path, params: { quiz_session: { title: "管理者の" } }
    }.not_to change(QuizSession, :count)
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "開催回に update の経路は無い（スナップショットを差し替えられない）" do
    user = users(:organizer)
    add_questions(user, 5)
    session = QuizSession.prepare(user: user, title: "本番").tap(&:save!)
    sign_in_as user

    patch "/organizer/quiz_sessions/#{session.id}", params: { quiz_session: { title: "x" } }

    expect(response).to have_http_status(:not_found)
    expect(session.reload.title).to eq "本番"
  end

  it "パスワードをログに出さない" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      .filter("host_password" => "abcdefghjkmn", "host_login_id" => "abcdefgh")

    expect(filtered.values.uniq).to eq %w[[FILTERED]]
  end

  it "設定ミスは専用の案内を出し pending のまま（秘密名は出さない）" do
    user = users(:organizer)
    add_questions(user, 5)
    sign_in_as user
    @fake_live = FakeLiveClient.new(:misconfigured)
    QuizSessionRegistrar.client_factory = -> { @fake_live }

    post organizer_quiz_sessions_path, params: { quiz_session: { title: "本番" } }
    created = user.quiz_sessions.order(:id).last

    expect(created).to be_pending
    follow_redirect!
    expect(response.body).to match(/接続設定が不足/)
    expect(response.body).not_to match(/ADMIN_API_SECRET/)
  end

  it "画像 URL 不正と認証失敗の案内に秘密名を出さない" do
    alerts = Organizer::QuizSessionsController.new.send(:registration_alert, :insecure_image_url)
    expect(alerts).to match(/https ではありません/)

    unauthorized = Organizer::QuizSessionsController.new.send(:registration_alert, :unauthorized)
    expect(unauthorized).to match(/管理者に設定を確認/)
    expect(unauthorized).not_to match(/ADMIN_API_SECRET/)
  end
end
