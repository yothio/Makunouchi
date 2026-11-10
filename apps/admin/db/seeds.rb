# 最初のシステム管理者を ADMIN_EMAIL / ADMIN_PASSWORD から 1 人作る。
# システム管理者が既にいれば何もしない（パスワードも変えない）。
if User.system_admin.exists?
  puts "システム管理者は作成済みです。何もしません。"
elsif ENV["ADMIN_EMAIL"].present? && ENV["ADMIN_PASSWORD"].present?
  User.create!(email: ENV["ADMIN_EMAIL"], password: ENV["ADMIN_PASSWORD"], role: :system_admin)
  puts "システム管理者 #{ENV["ADMIN_EMAIL"]} を作成しました。"
else
  puts "ADMIN_EMAIL と ADMIN_PASSWORD が未設定のため、システム管理者は作成しませんでした。"
end
