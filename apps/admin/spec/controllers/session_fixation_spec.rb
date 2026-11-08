require "rails_helper"

# リクエスト前に session を仕込む必要があるため controller spec にしている。
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
