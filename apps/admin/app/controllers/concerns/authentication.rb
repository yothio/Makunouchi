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
  def self.user_from(session)
    User.find_by(id: session[:user_id]) if session[:user_id]
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
    Current.user = user
  end

  def end_session
    reset_session
    Current.user = nil
  end
end
