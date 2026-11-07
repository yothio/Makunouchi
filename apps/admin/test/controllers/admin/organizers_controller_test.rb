require "test_helper"

class Admin::OrganizersControllerTest < ActionDispatch::IntegrationTest
  PARAMS = { user: { email: "new-organizer@example.com", password: "password123", password_confirmation: "password123" } }.freeze

  test "未ログインはログインへ" do
    get new_admin_organizer_path
    assert_redirected_to new_session_path

    assert_no_difference "User.count" do
      post admin_organizers_path, params: PARAMS
    end
    assert_redirected_to new_session_path
  end

  test "主催者は 403 で、作れない" do
    sign_in_as users(:organizer)

    get new_admin_organizer_path
    assert_response :forbidden

    assert_no_difference "User.count" do
      post admin_organizers_path, params: PARAMS
    end
    assert_response :forbidden
  end

  test "システム管理者は主催者を作れる。role は必ず organizer" do
    sign_in_as users(:system_admin)

    get new_admin_organizer_path
    assert_response :success

    assert_difference "User.count", 1 do
      post admin_organizers_path, params: { user: PARAMS[:user].merge(role: "system_admin") }
    end
    assert_redirected_to new_admin_organizer_path

    created = User.find_by!(email: "new-organizer@example.com")
    assert created.organizer?
    assert created.authenticate("password123")
  end

  test "不正な入力は 422 で作らない" do
    sign_in_as users(:system_admin)

    assert_no_difference "User.count" do
      post admin_organizers_path, params: { user: { email: "", password: "password123", password_confirmation: "password123" } }
    end
    assert_response :unprocessable_entity

    assert_no_difference "User.count" do
      post admin_organizers_path, params: { user: PARAMS[:user].merge(password_confirmation: "different") }
    end
    assert_response :unprocessable_entity
  end

  test "エラーメッセージは日本語" do
    sign_in_as users(:system_admin)

    post admin_organizers_path, params: { user: { email: "", password: "password123", password_confirmation: "password123" } }

    assert_select ".error li", text: /メールアドレス/
  end
end
