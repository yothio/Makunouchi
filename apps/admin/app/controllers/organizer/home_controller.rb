module Organizer
  # 主催者の管理画面トップ。問題数と問題一覧へのリンク、開催回の一覧と作成ボタン。
  class HomeController < ApplicationController
    def show
      @question_count = current_user.questions.count
      @quiz_sessions = current_user.quiz_sessions
    end
  end
end
