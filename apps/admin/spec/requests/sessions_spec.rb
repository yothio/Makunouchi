require "rails_helper"

RSpec.describe "Sessions", type: :request do
  let(:organizer) { create(:user) }
  let(:system_admin) { create(:user, :system_admin) }

  it "ログイン画面は未ログインで見られる" do
    get new_session_path

    expect(response).to have_http_status(:success)
    assert_select "form[action=?]", session_path
  end

  it "未ログインで管理画面トップに行くとログインへ" do
    get root_path

    expect(response).to redirect_to(new_session_path)
  end

  it "主催者のログイン成功は管理画面トップへ" do
    sign_in_as organizer

    expect(response).to redirect_to(root_path)
    follow_redirect!
    expect(response).to have_http_status(:success)
  end

  it "システム管理者のログイン成功は主催者作成画面へ" do
    sign_in_as system_admin

    expect(response).to redirect_to(new_admin_organizer_path)
  end

  it "パスワード違いと存在しないメールは同じ失敗で、ログインしない" do
    post session_path, params: { email: organizer.email, password: "wrong" }
    expect(response).to have_http_status(:unprocessable_content)
    message = css_select(".error").text

    post session_path, params: { email: "nobody@example.com", password: "wrong" }
    expect(response).to have_http_status(:unprocessable_content)
    expect(css_select(".error").text).to eq message
    expect(message).not_to be_empty

    get root_path
    expect(response).to redirect_to(new_session_path)
  end

  it "ログアウトするとセッションが消える" do
    sign_in_as organizer
    delete session_path

    expect(response).to redirect_to(new_session_path)
    expect(response).to have_http_status(:see_other)
    get root_path
    expect(response).to redirect_to(new_session_path)
  end

  it "ログアウト後に控えておいた古い cookie を再送しても入れない" do
    sign_in_as organizer
    old_cookie = cookies[Rails.application.config.session_options[:key]]
    get root_path
    expect(response).to have_http_status(:success)

    delete session_path
    cookies[Rails.application.config.session_options[:key]] = old_cookie

    get root_path
    expect(response).to redirect_to(new_session_path)
  end

  it "ログアウト後に入り直せば、新しいセッションは使える" do
    sign_in_as organizer
    delete session_path
    sign_in_as organizer

    get root_path
    expect(response).to have_http_status(:success)
  end

  it "ログイン時刻の無い古い形式のセッションは受け付けない" do
    user = organizer

    expect(Authentication.user_from({ user_id: user.id })).to be_nil
    expect(Authentication.user_from({ user_id: user.id, login_at: nil })).to be_nil
  end

  it "sessions_valid_after より前のログインは無効、それ以降は有効" do
    user = organizer
    cutoff = Time.current
    user.update_column(:sessions_valid_after, cutoff)
    micros = ->(time) { (time.to_r * 1_000_000).to_i }

    expect(Authentication.user_from({ user_id: user.id, login_at: micros.call(cutoff - 1.second) })).to be_nil
    expect(Authentication.user_from({ user_id: user.id, login_at: micros.call(cutoff + 1.second) })).to eq user
  end

  it "ログイン試行は IP ごとに 3 分で 10 回まで。超えたら 429" do
    10.times do
      post session_path, params: { email: "nobody@example.com", password: "wrong" }
      expect(response).to have_http_status(:unprocessable_content)
    end

    post session_path, params: { email: organizer.email, password: SignInHelper::PASSWORD }
    expect(response).to have_http_status(:too_many_requests)
    assert_select ".error"
  end

  it "ログイン試行はメールごとにも 3 分で 10 回まで" do
    10.times do |i|
      post session_path, params: { email: "target@example.com", password: "wrong" },
                         headers: { "REMOTE_ADDR" => "10.0.0.#{i + 1}" }
      expect(response).to have_http_status(:unprocessable_content)
    end

    post session_path, params: { email: "TARGET@example.com", password: "wrong" },
                       headers: { "REMOTE_ADDR" => "10.0.1.1" }
    expect(response).to have_http_status(:too_many_requests)
  end

  it "セッション cookie には有効期限がある（ログアウトでサーバー側は失効しない代わりの上限）" do
    expect(Rails.application.config.session_options[:expire_after]).to eq 8.hours
  end

  it "ログイン画面に出る文言は日本語で、翻訳漏れがフォールバックで英語になっても Translation missing にならない" do
    expect(I18n.t("errors.messages.not_a_number")).not_to match(/Translation missing|translation missing/i)
  end

  it "パスワードをログに出さない" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      .filter("password" => "secret-pass", "host_password" => "hp", "ADMIN_API_SECRET" => "s", "email" => "a@b.c")

    expect(filtered.values.uniq).to eq %w[[FILTERED]]
  end
end
