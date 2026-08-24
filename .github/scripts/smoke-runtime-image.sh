#!/usr/bin/env bash
set -Eeuo pipefail

: "${GARAK_RUNTIME_IMAGE:?set the exact SHA-tagged runtime image}"
: "${EXPECTED_AUTH_MODE:?set the expected portfolio authentication mode}"
: "${EXPECTED_BRANCH:?set the expected source branch}"
: "${EXPECTED_REVISION:?set the expected 40-character source revision}"

[[ "$EXPECTED_REVISION" =~ ^[0-9a-f]{40}$ ]]

container_name="garak-runtime-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
host_port=45176
health_headers=""

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [[ -n "$health_headers" && -f "$health_headers" ]]; then
    rm -f "$health_headers"
  fi
}
trap cleanup EXIT
cleanup

image_user=$(docker image inspect --format '{{.Config.User}}' "$GARAK_RUNTIME_IMAGE")
image_arch=$(docker image inspect --format '{{.Architecture}}' "$GARAK_RUNTIME_IMAGE")
image_branch=$(docker image inspect --format '{{index .Config.Labels "work.bonifacio.portfolio.branch"}}' "$GARAK_RUNTIME_IMAGE")
image_auth_mode=$(docker image inspect --format '{{index .Config.Labels "work.bonifacio.portfolio.auth-mode"}}' "$GARAK_RUNTIME_IMAGE")
image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$GARAK_RUNTIME_IMAGE")

[[ "$image_user" == "10001:10001" ]]
[[ "$image_arch" == "arm64" ]]
[[ "$image_branch" == "$EXPECTED_BRANCH" ]]
[[ "$image_auth_mode" == "$EXPECTED_AUTH_MODE" ]]
[[ "$image_revision" == "$EXPECTED_REVISION" ]]

docker run --detach --rm \
  --name "$container_name" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --publish "127.0.0.1:${host_port}:3000" \
  "$GARAK_RUNTIME_IMAGE" >/dev/null

ready=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:${host_port}/garak/healthz" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  docker logs "$container_name" >&2 || true
  printf '%s\n' 'Garak runtime image did not become ready' >&2
  exit 1
fi

health_headers=$(mktemp)
health_body=$(curl --fail --silent --show-error \
  --dump-header "$health_headers" \
  "http://127.0.0.1:${host_port}/garak/healthz")
grep -Eiq '^cache-control:[[:space:]]*no-store' "$health_headers"
grep -Fq '"service":"garak"' <<<"$health_body"
grep -Fq '"status":"ok"' <<<"$health_body"

html=$(curl --fail --silent --show-error "http://127.0.0.1:${host_port}/garak/")
grep -Fq '<title>Garak — Orchestra notation studio</title>' <<<"$html"
grep -Fq 'https://bonifacio.work/garak/' <<<"$html"
grep -Fq 'https://bonifacio.work/garak/og.png' <<<"$html"
grep -Fq 'https://bonifacio.work/garak/favicon.svg' <<<"$html"
grep -Fq '/garak/_next/static/' <<<"$html"

asset_path=$(grep -Eo '/garak/_next/static/[^"\\ )<]+' <<<"$html" | sed -n '1p')
[[ -n "$asset_path" ]]
curl --fail --silent --show-error \
  "http://127.0.0.1:${host_port}${asset_path}" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${host_port}/garak/og.png" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${host_port}/garak/favicon.svg" >/dev/null

outside_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${host_port}/")
[[ "$outside_status" == "404" ]]

printf '%s\n' 'Garak ARM64 runtime image smoke test: ok'
