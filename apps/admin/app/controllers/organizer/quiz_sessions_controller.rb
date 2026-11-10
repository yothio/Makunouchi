module Organizer
  class QuizSessionsController < ApplicationController
    before_action :set_quiz_session, only: %i[show register]

    def new
      @quiz_session = QuizSession.new
    end

    def create
      # user・status・public_id・幹事の ID/パスワードは params から受けず、サーバーで決める。
      @quiz_session = QuizSession.prepare(user: current_user, title: quiz_session_params[:title])

      if @quiz_session.save
        redirect_after_registration(@quiz_session.register_with_live)
      else
        render :new, status: :unprocessable_entity
      end
    end

    def show
      # 幹事の平文パスワードを出す画面なので、戻るボタンやブラウザのキャッシュに残さない。
      response.headers["Cache-Control"] = "no-store"
    end

    def register
      if @quiz_session.host_missing?
        redirect_to organizer_quiz_session_path(@quiz_session), alert: registration_alert(:host_missing)
        return
      end
      unless @quiz_session.pending?
        redirect_to organizer_quiz_session_path(@quiz_session)
        return
      end

      redirect_after_registration(@quiz_session.register_with_live)
    end

    private

    def set_quiz_session
      @quiz_session = current_user.quiz_sessions.find(params[:id])
    end

    def quiz_session_params
      params.expect(quiz_session: [ :title ])
    end

    def redirect_after_registration(result)
      if result == :ready
        redirect_to organizer_quiz_session_path(@quiz_session), notice: t("flash.quiz_sessions.registered")
      else
        redirect_to organizer_quiz_session_path(@quiz_session), alert: registration_alert(result)
      end
    end

    def registration_alert(result)
      case result
      when :host_missing
        t("quiz_session.status.host_missing")
      when :invalid_payload, :invalid_session_id, :unauthorized, :misconfigured, :insecure_image_url
        t("quiz_session.registration.#{result}")
      else
        t("quiz_session.registration.failed")
      end
    end
  end
end
