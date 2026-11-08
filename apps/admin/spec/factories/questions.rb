FactoryBot.define do
  factory :question do
    user
    sequence(:title, 0) { |n| "問題#{n}" }
    choice_a { "a" }
    choice_b { "b" }
    choice_c { "c" }
    choice_d { "d" }
    sequence(:correct_index, 0) { |n| n % 4 }

    trait :with_image do
      after(:build) do |question|
        question.image.attach(
          io: File.open(Rails.root.join("spec/fixtures/files/sample.png")),
          filename: "sample.png",
          content_type: "image/png"
        )
      end
    end
  end
end
