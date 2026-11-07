class AddSessionsValidAfterToUsers < ActiveRecord::Migration[8.1]
  def change
    # これより前にログインしたセッション（cookie）は無効。ログアウトで更新する軽い失効。
    add_column :users, :sessions_valid_after, :datetime
  end
end
