class SessionsController < ApplicationController
  # ログイン試行の回数制限。キャッシュ（本番は memory_store）には依存せず、専用のプロセス内ストアを使う。
  # インスタンスごとの回数になる（Cloud Run の複数インスタンスでは緩くなるが、制限なしよりはるかによい）。
  LOGIN_RATE_LIMIT_STORE = ActiveSupport::Cache::MemoryStore.new
  TOO_MANY_ATTEMPTS = "ログインの試行が多すぎます。しばらく待ってからやり直してください。".freeze

  allow_unauthenticated_access only: %i[new create]

  # 接続元 IP ごと、メールアドレスごと、の両方で 3 分に 10 回まで。
  rate_limit to: 10, within: 3.minutes, only: :create, store: LOGIN_RATE_LIMIT_STORE, name: "ip",
             with: -> { render_too_many_attempts }
  rate_limit to: 10, within: 3.minutes, only: :create, store: LOGIN_RATE_LIMIT_STORE, name: "email",
             by: -> { params[:email].to_s.strip.downcase }, with: -> { render_too_many_attempts }

  def new
  end

  def create
    user = User.authenticate_by(email: params[:email].to_s.strip.downcase, password: params[:password].to_s)

    if user
      start_session_for(user)
      redirect_to after_login_path(user)
    else
      @error = "メールアドレスまたはパスワードが違います。"
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    end_session
    redirect_to new_session_path
  end

  private

  def render_too_many_attempts
    @error = TOO_MANY_ATTEMPTS
    render :new, status: :too_many_requests
  end

  def after_login_path(user)
    user.system_admin? ? new_admin_organizer_path : root_path
  end
end
