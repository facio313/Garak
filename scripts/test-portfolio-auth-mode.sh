#!/bin/sh
set -eu

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
resolver=$script_directory/portfolio-auth-mode.sh

assert_mode() {
  branch=$1
  expected=$2
  actual=$(unset PORTFOLIO_AUTH_MODE GITHUB_REF_NAME; PORTFOLIO_BRANCH=$branch "$resolver" print)
  [ "$actual" = "$expected" ] || {
    printf 'expected %s for %s, got %s\n' "$expected" "$branch" "$actual" >&2
    exit 1
  }
}

assert_rejected() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'unexpected acceptance: %s\n' "$label" >&2
    exit 1
  fi
}

assert_mode main sso
assert_mode dev local
assert_mode refs/heads/main sso
assert_mode refs/heads/dev local

for branch in codex cursor anthropic feature/auth-contract; do
  assert_rejected "unsupported branch $branch" env PORTFOLIO_BRANCH="$branch" PORTFOLIO_AUTH_MODE=local "$resolver" check
done
assert_rejected 'main/local mismatch' env PORTFOLIO_BRANCH=main PORTFOLIO_AUTH_MODE=local "$resolver" check
assert_rejected 'dev/sso mismatch' env PORTFOLIO_BRANCH=dev PORTFOLIO_AUTH_MODE=sso "$resolver" check
assert_rejected 'empty explicit branch' env PORTFOLIO_BRANCH= PORTFOLIO_AUTH_MODE=local "$resolver" check
assert_rejected 'unsupported branch characters' env PORTFOLIO_BRANCH='dev invalid' PORTFOLIO_AUTH_MODE=local "$resolver" check
assert_rejected 'empty exec command' env PORTFOLIO_BRANCH=dev PORTFOLIO_AUTH_MODE=local "$resolver" exec --
assert_rejected 'unknown resolver command' env PORTFOLIO_BRANCH=dev PORTFOLIO_AUTH_MODE=local "$resolver" unknown

github_mode=$(unset PORTFOLIO_BRANCH PORTFOLIO_AUTH_MODE; GITHUB_REF_NAME=dev "$resolver" print)
[ "$github_mode" = local ]
explicit_mode=$(unset PORTFOLIO_AUTH_MODE; PORTFOLIO_BRANCH=main GITHUB_REF_NAME=dev "$resolver" print)
[ "$explicit_mode" = sso ]

dev_contract=$(PORTFOLIO_BRANCH=dev PORTFOLIO_AUTH_MODE=local "$resolver" contract)
[ "$dev_contract" = "$(printf 'dev\nlocal')" ]
dev_environment=$(PORTFOLIO_BRANCH=dev PORTFOLIO_AUTH_MODE=local "$resolver" exec -- env)
printf '%s\n' "$dev_environment" | grep -Fqx 'PORTFOLIO_BRANCH=dev'
printf '%s\n' "$dev_environment" | grep -Fqx 'PORTFOLIO_AUTH_MODE=local'

printf '%s\n' 'portfolio auth mode contract: ok'
