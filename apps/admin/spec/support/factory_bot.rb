RSpec.configure do |config|
  config.include FactoryBot::Syntax::Methods

  # 連番を例ごとに 0 から振り直す。作った順に 問題0, 問題1, ... になり、実行順に左右されない。
  config.before do
    FactoryBot.rewind_sequences
  end
end
