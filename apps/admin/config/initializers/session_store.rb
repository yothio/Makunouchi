# セッションは暗号化 cookie ストア。有効期限は最後に使ってから 8 時間（ローリング）。
# ログアウトでは users.sessions_valid_after を更新して、それより前のセッションをサーバー側で無効にする
# （Authentication.user_from。README 参照）。
Rails.application.config.session_store :cookie_store, key: "_admin_session", expire_after: 8.hours
