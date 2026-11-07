class SessionsController < ApplicationController
  allow_unauthenticated_access only: %i[new create]

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

  def after_login_path(user)
    user.system_admin? ? new_admin_organizer_path : root_path
  end
end
