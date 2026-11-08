require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "active_storage/engine"
require "action_controller/railtie"
# require "action_mailer/railtie"
require "action_view/railtie"
# require "action_cable/engine"
require "rails/test_unit/railtie"

Bundler.require(*Rails.groups)

module Admin
  class Application < Rails::Application
    config.load_defaults 8.1

    config.autoload_lib(ignore: %w[assets tasks canonical_host_redirect.rb])

    # default_locale :ja（rails-i18n は使わず ja.yml のみ）
    config.i18n.default_locale = :ja
    config.i18n.fallbacks = [ :en ]
  end
end
