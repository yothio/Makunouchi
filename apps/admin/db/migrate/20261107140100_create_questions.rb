class CreateQuestions < ActiveRecord::Migration[8.1]
  def change
    create_table :questions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :title, null: false
      t.string :choice_a, null: false
      t.string :choice_b, null: false
      t.string :choice_c, null: false
      t.string :choice_d, null: false
      t.integer :correct_index, null: false

      t.timestamps
    end
    add_check_constraint :questions, "correct_index BETWEEN 0 AND 3", name: "questions_correct_index_check"
  end
end
