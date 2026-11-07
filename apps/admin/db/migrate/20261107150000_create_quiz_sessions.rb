class CreateQuizSessions < ActiveRecord::Migration[8.1]
  def change
    create_table :quiz_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :public_id, null: false
      t.string :title, null: false
      t.jsonb :quiz_snapshot, null: false
      t.string :status, null: false, default: "pending"
      t.string :host_login_id, null: false
      t.text :host_password, null: false # Active Record Encryption で暗号化して保存する
      t.string :host_password_hash, null: false # live に送るハッシュ。再試行でも同じ値を送る

      t.timestamps
    end
    add_index :quiz_sessions, :public_id, unique: true
    add_check_constraint :quiz_sessions, "status IN ('pending', 'ready', 'host_missing')", name: "quiz_sessions_status_check"
  end
end
