# ログイン状態（セッション cookie の user_id）を扱う。通常のコントローラーと、
# ApplicationController を継承しない Active Storage の direct upload（Task 3）の両方から使う。
module Authentication
  extend ActiveSupport::Concern

  included do
    before_action :require_login
    helper_method :current_user
  end

  class_methods do
    def allow_unauthenticated_access(**options)
      skip_before_action :require_login, **options
    end
  end

  # セッションからユーザーを引く。無ければ nil。
  # ログイン時刻（マイクロ秒の整数）が users.sessions_valid_after より前のセッションは無効
  # （ログアウトで更新するので、控えておいた古い cookie を再送しても入れない）。
  def self.user_from(session)
    user = User.find_by(id: session[:user_id]) if session[:user_id]
    return unless user && session[:login_at]

    valid_after = user.sessions_valid_after
    user if valid_after.nil? || session[:login_at] >= micros(valid_after)
  end

  def self.micros(time)
    (time.to_r * 1_000_000).to_i
  end

  private

  def current_user
    Current.user ||= Authentication.user_from(session)
  end

  def require_login
    redirect_to new_session_path unless current_user
  end

  def require_system_admin
    head :forbidden unless current_user&.system_admin?
  end

  # セッション固定を避けるため、ログイン・ログアウトのたびにセッションを作り直す。
  def start_session_for(user)
    reset_session
    session[:user_id] = user.id
    session[:login_at] = Authentication.micros(Time.current)
    Current.user = user
  end

  # 同じユーザーの、これより前のセッション（他の端末を含む）もすべて無効になる。
  def end_session
    current_user&.update_column(:sessions_valid_after, Time.current)
    reset_session
    Current.user = nil
  end
end
