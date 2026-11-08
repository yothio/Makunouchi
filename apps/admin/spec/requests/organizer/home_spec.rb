require "rails_helper"

RSpec.describe Organizer::HomeController, type: :request do
  it "トップに問題の数と、問題一覧へのリンクが出る" do
    sign_in_as users(:organizer)

    get root_path

    expect(response).to have_http_status(:success)
    assert_select ".question-count", text: /2/
    assert_select "a[href=?]", organizer_questions_path
  end

  it "順位や結果は出さない" do
    sign_in_as users(:organizer)

    get root_path

    expect(response.body).not_to match(/順位|結果|ranking/)
  end

  it "システム管理者のトップは問題 0 件" do
    sign_in_as users(:system_admin)

    get root_path

    assert_select ".question-count", text: /0/
  end
end
