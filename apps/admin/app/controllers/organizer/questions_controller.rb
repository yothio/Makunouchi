module Organizer
  class QuestionsController < ApplicationController
    before_action :set_question, only: %i[edit update destroy]

    def index
      @questions = current_user.questions
    end

    def new
      @question = current_user.questions.new
    end

    def create
      @question = current_user.questions.new(question_params)

      if @question.save
        redirect_to organizer_questions_path, notice: t("flash.questions.saved")
      else
        render :new, status: :unprocessable_entity
      end
    end

    def edit
    end

    def update
      if @question.update(question_params)
        redirect_to organizer_questions_path, notice: t("flash.questions.saved"), status: :see_other
      else
        render :edit, status: :unprocessable_entity
      end
    end

    def destroy
      @question.destroy!
      redirect_to organizer_questions_path, notice: t("flash.questions.destroyed"), status: :see_other
    end

    private

    def set_question
      @question = current_user.questions.find(params[:id])
    end

    def question_params
      attrs = params.expect(question: %i[title choice_a choice_b choice_c choice_d correct_index image])
      attrs.delete(:image) if attrs[:image].blank?
      attrs
    end
  end
end
