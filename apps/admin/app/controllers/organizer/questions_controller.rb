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
        redirect_to organizer_questions_path, notice: "問題を保存しました。"
      else
        render :new, status: :unprocessable_entity
      end
    end

    def edit
    end

    def update
      if @question.update(question_params)
        redirect_to organizer_questions_path, notice: "問題を保存しました。"
      else
        render :edit, status: :unprocessable_entity
      end
    end

    def destroy
      @question.destroy!
      redirect_to organizer_questions_path, notice: "問題を削除しました。"
    end

    private

    # 自分の問題だけ。他人の問題は RecordNotFound（404）になる。
    def set_question
      @question = current_user.questions.find(params[:id])
    end

    def question_params
      attrs = params.expect(question: %i[title choice_a choice_b choice_c choice_d correct_index image])
      # 画像を選ばなかったときの空文字は、今の画像を消さないよう無視する。
      attrs.delete(:image) if attrs[:image].blank?
      attrs
    end
  end
end
