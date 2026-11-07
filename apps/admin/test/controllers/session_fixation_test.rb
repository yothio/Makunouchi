require "test_helper"

# reset_session を外すと落ちるように、ログイン前にセッションへ印を入れて、
# ログイン・ログアウトのあとに消えていることを見る（機能テスト）。
class SessionFixationTest < ActionController::TestCase
  tests SessionsController

  test "ログイン成功でログイン前のセッションの中身は引き継がれない" do
    @request.session[:marker] = "attacker-controlled"

    post :create, params: { email: users(:organizer).email, password: SignInHelper::PASSWORD }

    assert_nil session[:marker]
    assert_equal users(:organizer).id, session[:user_id]
  end

  test "ログアウトでセッションの中身は全部消える" do
    @request.session[:user_id] = users(:organizer).id
    @request.session[:marker] = "x"

    delete :destroy

    assert_nil session[:user_id]
    assert_nil session[:marker]
  end
end
