module Organizer
  # 開催回の作成と詳細。作った時点の問題一式がスナップショットになり、あとから差し替えない（update は無い）。
  class QuizSessionsController < ApplicationController
    def new
      @quiz_session = QuizSession.new
    end

    def create
      # user・status・public_id・幹事の ID/パスワードは params から受けず、サーバーで決める。
      @quiz_session = QuizSession.prepare(user: current_user, title: params.expect(quiz_session: [ :title ])[:title])

      if @quiz_session.save
        redirect_to organizer_quiz_session_path(@quiz_session)
      else
        render :new, status: :unprocessable_entity
      end
    end

    def show
      @quiz_session = current_user.quiz_sessions.find(params[:id])
      # 幹事の平文パスワードを出す画面なので、戻るボタンやブラウザのキャッシュに残さない。
      response.headers["Cache-Control"] = "no-store"
    end
  end
end
