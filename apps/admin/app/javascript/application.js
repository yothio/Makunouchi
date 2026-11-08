// Configure your import map in config/importmap.rb. Read more: https://github.com/rails/importmap-rails
import "@hotwired/turbo-rails"
import * as ActiveStorage from "@rails/activestorage"
import "controllers"

// 画像は direct upload（ブラウザから R2 に直接 PUT）で送る。
ActiveStorage.start()
