Rails.application.routes.draw do
  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  resource :session, only: %i[new create destroy]

  namespace :admin do
    resources :organizers, only: %i[new create]
  end

  namespace :organizer do
    resources :questions, except: :show
    # 開催回は作って見るだけ。スナップショットを差し替える update は作らない。
    resources :quiz_sessions, only: %i[new create show]
  end

  root "organizer/home#show"
end
