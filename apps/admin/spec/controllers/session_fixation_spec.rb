require "rails_helper"

# reset_session を外すと落ちるように、ログイン前にセッションへ印を入れて、
# ログイン・ログアウトのあとに消えていることを見る（機能テスト）。
# リクエストの前にセッションを仕込む必要があるので request spec ではなく controller spec にしている。
RSpec.describe SessionsController, type: :controller do
  it "ログイン成功でログイン前のセッションの中身は引き継がれない" do
    request.session[:marker] = "attacker-controlled"

    post :create, params: { email: users(:organizer).email, password: SignInHelper::PASSWORD }

    expect(session[:marker]).to be_nil
    expect(session[:user_id]).to eq users(:organizer).id
  end

  it "ログアウトでセッションの中身は全部消える" do
    request.session[:user_id] = users(:organizer).id
    request.session[:login_at] = Authentication.micros(Time.current)
    request.session[:marker] = "x"

    delete :destroy

    expect(session[:user_id]).to be_nil
    expect(session[:marker]).to be_nil
  end
end
