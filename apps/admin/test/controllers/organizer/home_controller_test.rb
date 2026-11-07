require "test_helper"

class Organizer::HomeControllerTest < ActionDispatch::IntegrationTest
  test "トップに問題の数と、問題一覧へのリンクが出る" do
    sign_in_as users(:organizer)

    get root_path

    assert_response :success
    assert_select ".question-count", text: /2/
    assert_select "a[href=?]", organizer_questions_path
  end

  test "順位や結果は出さない" do
    sign_in_as users(:organizer)

    get root_path

    assert_no_match(/順位|結果|ranking/, response.body)
  end

  test "システム管理者のトップは問題 0 件" do
    sign_in_as users(:system_admin)

    get root_path

    assert_select ".question-count", text: /0/
  end
end
