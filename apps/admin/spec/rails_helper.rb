require 'spec_helper'
ENV['RAILS_ENV'] ||= 'test'
require_relative '../config/environment'
abort("The Rails environment is running in production mode!") if Rails.env.production?
require 'rspec/rails'

Rails.root.glob('spec/support/**/*.rb').sort_by(&:to_s).each { |f| require f }

begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end
RSpec.configure do |config|
  config.use_transactional_fixtures = true

  # fixtures を使わないため、コミット済みの旧 fixture 行は example のロールバックでは消えない。
  # suite 開始時に空にして、一意制約の衝突を防ぐ。
  config.before(:suite) do
    ActiveRecord::Tasks::DatabaseTasks.truncate_all
  end

  # spec/services は type を付けずに書くので、トランザクションの仕組みだけ個別に入れる。
  config.include RSpec::Rails::RailsExampleGroup, file_path: %r{/spec/services/}

  config.filter_rails_from_backtrace!
end
