module Organizer
  # 主催者の管理画面トップ。問題数と問題一覧へのリンク。開催回は Task 4 以降で足す。
  class HomeController < ApplicationController
    def show
      @question_count = current_user.questions.count
    end
  end
end
