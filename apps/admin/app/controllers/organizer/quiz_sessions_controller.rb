module Organizer
  # 開催回の作成と詳細。作った時点の問題一式がスナップショットになり、あとから差し替えない（update は無い）。
  # 作成後に live へ PUT し、pending の再送は register。
  class QuizSessionsController < ApplicationController
    def new
      @quiz_session = QuizSession.new
    end

    def create
      # user・status・public_id・幹事の ID/パスワードは params から受けず、サーバーで決める。
      @quiz_session = QuizSession.prepare(user: current_user, title: params.expect(quiz_session: [ :title ])[:title])

      if @quiz_session.save
        result = QuizSessionRegistrar.call(@quiz_session)
        if result == :ready
          redirect_to organizer_quiz_session_path(@quiz_session), notice: "開催回を登録しました。"
        else
          redirect_to organizer_quiz_session_path(@quiz_session), alert: registration_alert(result)
        end
      else
        render :new, status: :unprocessable_entity
      end
    end

    def show
      @quiz_session = current_user.quiz_sessions.find(params[:id])
      # 幹事の平文パスワードを出す画面なので、戻るボタンやブラウザのキャッシュに残さない。
      response.headers["Cache-Control"] = "no-store"
    end

    def register
      @quiz_session = current_user.quiz_sessions.find(params[:id])
      if @quiz_session.host_missing?
        redirect_to organizer_quiz_session_path(@quiz_session), alert: registration_alert(:host_missing)
        return
      end
      unless @quiz_session.pending?
        redirect_to organizer_quiz_session_path(@quiz_session)
        return
      end

      result = QuizSessionRegistrar.call(@quiz_session)
      if result == :ready
        redirect_to organizer_quiz_session_path(@quiz_session), notice: "開催回を登録しました。"
      else
        redirect_to organizer_quiz_session_path(@quiz_session), alert: registration_alert(result)
      end
    end

    private

    def registration_alert(result)
      case result
      when :host_missing
        I18n.t("quiz_session.status.host_missing")
      when :invalid_payload
        "live がペイロードを受理しませんでした。内容を確認してから、もう一度送ってください。"
      when :invalid_session_id
        "開催回 ID の形式が live に通りませんでした。"
      when :unauthorized
        "live への認証に失敗しました。管理者に設定を確認してもらってください。"
      when :misconfigured
        "live への接続設定が不足しています。管理者に設定を確認してもらってください。"
      when :insecure_image_url
        "画像の公開 URL が https ではありません。R2 の公開設定を確認してから、もう一度送ってください。"
      else
        "live への登録に失敗しました。しばらくしてから、もう一度送ってください。"
      end
    end
  end
end
