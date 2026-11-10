require "rails_helper"

RSpec.describe "Admin organizers", type: :request do
  let(:organizer) { create(:user) }
  let(:system_admin) { create(:user, :system_admin) }
  let(:params) { { user: { email: "new-organizer@example.com", password: "password12345", password_confirmation: "password12345" } } }

  it "システム管理者が主催者用の画面（管理画面トップ）に入れるのは決定どおり" do
    sign_in_as system_admin

    get root_path

    expect(response).to have_http_status(:success)
  end

  it "未ログインはログインへ" do
    get new_admin_organizer_path
    expect(response).to redirect_to(new_session_path)

    expect { post admin_organizers_path, params: params }.not_to change(User, :count)
    expect(response).to redirect_to(new_session_path)
  end

  it "主催者は 403 で、作れない" do
    sign_in_as organizer

    get new_admin_organizer_path
    expect(response).to have_http_status(:forbidden)

    expect { post admin_organizers_path, params: params }.not_to change(User, :count)
    expect(response).to have_http_status(:forbidden)
  end

  it "システム管理者は主催者を作れる。role は必ず organizer" do
    sign_in_as system_admin

    get new_admin_organizer_path
    expect(response).to have_http_status(:success)

    expect {
      post admin_organizers_path, params: { user: params[:user].merge(role: "system_admin") }
    }.to change(User, :count).by(1)
    expect(response).to redirect_to(new_admin_organizer_path)

    created = User.find_by!(email: "new-organizer@example.com")
    expect(created).to be_organizer
    expect(created.authenticate("password12345")).to be_truthy
  end

  it "不正な入力は 422 で作らない" do
    sign_in_as system_admin

    expect {
      post admin_organizers_path, params: { user: { email: "", password: "password12345", password_confirmation: "password12345" } }
    }.not_to change(User, :count)
    expect(response).to have_http_status(:unprocessable_content)

    expect {
      post admin_organizers_path, params: { user: params[:user].merge(password_confirmation: "different") }
    }.not_to change(User, :count)
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "11 文字のパスワードでは主催者を作れない" do
    sign_in_as system_admin

    expect {
      post admin_organizers_path, params: { user: { email: "weak@example.com", password: "a" * 11, password_confirmation: "a" * 11 } }
    }.not_to change(User, :count)
    expect(response).to have_http_status(:unprocessable_content)
    assert_select ".error li", text: /パスワード.*12文字以上/
  end

  it "エラーメッセージは日本語" do
    sign_in_as system_admin

    post admin_organizers_path, params: { user: { email: "", password: "password12345", password_confirmation: "password12345" } }

    assert_select ".error li", text: /メールアドレス/
  end
end
