Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  resource :session, only: %i[new create destroy]

  namespace :admin do
    resources :organizers, only: %i[new create]
  end

  namespace :organizer do
    resources :questions, except: :show
    # 開催回は作って見るだけ。スナップショットを差し替える update は作らない。
    # pending の再送は register（同一 public_id・同一ハッシュ）。
    resources :quiz_sessions, only: %i[new create show] do
      member { post :register }
    end
  end

  root "organizer/home#show"
end
