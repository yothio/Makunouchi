# 暗号化 cookie、ローリング 8h。失効は sessions_valid_after（Authentication.user_from）。
Rails.application.config.session_store :cookie_store, key: "_admin_session", expire_after: 8.hours
