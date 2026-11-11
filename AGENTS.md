# Garak — agent instructions

## Main/dev workflow (2026-11-12)

- Active branches are `main` for production and `dev` for development. Tool and feature branches are retired.
- Before changing code, fetch remote `main`, inspect local changes, and integrate that baseline into `dev` without discarding work.
- All implementation and local application execution use `dev`. The canonical resolver enforces `main=sso`, `dev=local`, and rejects any other branch or conflicting explicit mode.
- CI validates both branches. Production image publishing and server deployment accept only reviewed `main` commits; `dev` never triggers a production deployment.
- Preserve unique commits and dirty, untracked, and ignored files before retiring old worktrees. Archived worktrees are not development run targets.
