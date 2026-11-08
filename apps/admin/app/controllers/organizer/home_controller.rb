module Organizer
  class HomeController < ApplicationController
    def show
      @question_count = current_user.questions.count
      @quiz_sessions = current_user.quiz_sessions
    end
  end
end
