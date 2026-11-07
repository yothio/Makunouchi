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

  test "ログイン時にセッションを作り直す（セッション固定を避ける）" do
    get new_session_path
    before = request.session.id.to_s
    sign_in_as users(:organizer)

    assert_not_equal before, request.session.id.to_s
  end

  test "パスワードをログに出さない" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      .filter("password" => "secret-pass", "host_password" => "hp", "ADMIN_API_SECRET" => "s", "email" => "a@b.c")

    assert_equal(%w[[FILTERED]], filtered.values.uniq)
  end
end
