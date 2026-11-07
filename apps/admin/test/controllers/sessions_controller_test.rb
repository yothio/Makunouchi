require "test_helper"

class SessionsControllerTest < ActionDispatch::IntegrationTest
  test "ログイン画面は未ログインで見られる" do
    get new_session_path

    assert_response :success
    assert_select "form[action=?]", session_path
  end

  test "未ログインで管理画面トップに行くとログインへ" do
    get root_path

    assert_redirected_to new_session_path
  end

  test "主催者のログイン成功は管理画面トップへ" do
    sign_in_as users(:organizer)

    assert_redirected_to root_path
    follow_redirect!
    assert_response :success
  end

  test "システム管理者のログイン成功は主催者作成画面へ" do
    sign_in_as users(:system_admin)

    assert_redirected_to new_admin_organizer_path
  end

  test "パスワード違いと存在しないメールは同じ失敗で、ログインしない" do
    post session_path, params: { email: users(:organizer).email, password: "wrong" }
    assert_response :unprocessable_entity
    message = css_select(".error").text

    post session_path, params: { email: "nobody@example.com", password: "wrong" }
    assert_response :unprocessable_entity
    assert_equal message, css_select(".error").text
    assert_not_empty message

    get root_path
    assert_redirected_to new_session_path
  end

  test "ログアウトするとセッションが消える" do
    sign_in_as users(:organizer)
    delete session_path

    assert_redirected_to new_session_path
    get root_path
    assert_redirected_to new_session_path
  end

  test "ログアウト後に控えておいた古い cookie を再送しても入れない" do
    sign_in_as users(:organizer)
    old_cookie = cookies[Rails.application.config.session_options[:key]]
    get root_path
    assert_response :success

    delete session_path
    cookies[Rails.application.config.session_options[:key]] = old_cookie

    get root_path
    assert_redirected_to new_session_path
  end

  test "ログアウト後に入り直せば、新しいセッションは使える" do
    sign_in_as users(:organizer)
    delete session_path
    sign_in_as users(:organizer)

    get root_path
    assert_response :success
  end

  test "ログイン時刻の無い古い形式のセッションは受け付けない" do
    user = users(:organizer)

    assert_nil Authentication.user_from({ user_id: user.id })
    assert_nil Authentication.user_from({ user_id: user.id, login_at: nil })
  end

  test "sessions_valid_after より前のログインは無効、それ以降は有効" do
    user = users(:organizer)
    cutoff = Time.current
    user.update_column(:sessions_valid_after, cutoff)
    micros = ->(time) { (time.to_r * 1_000_000).to_i }

    assert_nil Authentication.user_from({ user_id: user.id, login_at: micros.call(cutoff - 1.second) })
    assert_equal user, Authentication.user_from({ user_id: user.id, login_at: micros.call(cutoff + 1.second) })
  end

  test "ログイン試行は IP ごとに 3 分で 10 回まで。超えたら 429" do
    10.times do
      post session_path, params: { email: "nobody@example.com", password: "wrong" }
      assert_response :unprocessable_entity
    end

    post session_path, params: { email: users(:organizer).email, password: SignInHelper::PASSWORD }
    assert_response :too_many_requests
    assert_select ".error"
  end

  test "ログイン試行はメールごとにも 3 分で 10 回まで" do
    10.times do |i|
      post session_path, params: { email: "target@example.com", password: "wrong" },
                         headers: { "REMOTE_ADDR" => "10.0.0.#{i + 1}" }
      assert_response :unprocessable_entity
    end

    post session_path, params: { email: "TARGET@example.com", password: "wrong" },
                       headers: { "REMOTE_ADDR" => "10.0.1.1" }
    assert_response :too_many_requests
  end

  test "セッション cookie には有効期限がある（ログアウトでサーバー側は失効しない代わりの上限）" do
    assert_equal 8.hours, Rails.application.config.session_options[:expire_after]
  end

  test "ログイン画面に出る文言は日本語で、翻訳漏れがフォールバックで英語になっても Translation missing にならない" do
    assert_no_match(/Translation missing|translation missing/i, I18n.t("errors.messages.not_a_number"))
  end

  test "パスワードをログに出さない" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      .filter("password" => "secret-pass", "host_password" => "hp", "ADMIN_API_SECRET" => "s", "email" => "a@b.c")

    assert_equal(%w[[FILTERED]], filtered.values.uniq)
  end
end
