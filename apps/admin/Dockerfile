# syntax=docker/dockerfile:1
# check=error=true

# Cloud Run: PORT（既定 8080）。起動時 migrate なし。HEALTHCHECK は置かず Probe は Cloud Run の GET /up。

ARG RUBY_VERSION=4.0.6
FROM docker.io/library/ruby:$RUBY_VERSION-slim AS base

WORKDIR /rails

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 libvips libpq5 && \
    ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development" \
    PORT="8080" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so"

FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libpq-dev libvips libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY vendor/* ./vendor/
COPY Gemfile Gemfile.lock ./

RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    # -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
    bundle exec bootsnap precompile -j 1 --gemfile

COPY . .

# -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
RUN bundle exec bootsnap precompile -j 1 app/ lib/

# R2_* と Active Record Encryption の鍵は本番の起動時に必須（storage.yml の r2）。ビルド中だけダミーを渡す（ENV ではないのでイメージには残らない）。
RUN SECRET_KEY_BASE_DUMMY=1 R2_BUCKET=build-dummy R2_ENDPOINT=https://build-dummy.invalid R2_ACCESS_KEY_ID=build-dummy R2_SECRET_ACCESS_KEY=build-dummy ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=build-dummy ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY=build-dummy ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT=build-dummy ./bin/rails assets:precompile




FROM base

RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
USER 1000:1000

COPY --chown=rails:rails --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --chown=rails:rails --from=build /rails /rails

ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# PORT は Cloud Run が渡す（無ければ 8080）。起動時 migrate なし。
EXPOSE 8080
CMD ["./bin/rails", "server"]
