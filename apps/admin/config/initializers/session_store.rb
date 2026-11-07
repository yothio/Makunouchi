# セッションは暗号化 cookie ストア。サーバー側に失効の仕組みは無く、ログアウトしても控えた cookie は
# 有効期限まで使える（README 参照）。せめて期限を付けて上限を決める。
Rails.application.config.session_store :cookie_store, key: "_admin_session", expire_after: 8.hours
