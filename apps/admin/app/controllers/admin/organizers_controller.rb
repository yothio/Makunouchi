module Admin
  class OrganizersController < ApplicationController
    before_action :require_system_admin

    def new
      @user = User.new
    end

    def create
      # role は params から受け取らず、必ず organizer にする（システム管理者の追加はここでは作らない）。
      @user = User.new(organizer_params.merge(role: :organizer))

      if @user.save
        redirect_to new_admin_organizer_path, notice: t("flash.organizers.created", email: @user.email)
      else
        render :new, status: :unprocessable_entity
      end
    end

    private

    def organizer_params
      params.expect(user: %i[email password password_confirmation])
    end
  end
end
