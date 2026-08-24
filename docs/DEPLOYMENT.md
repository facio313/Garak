# Garak Raspberry Pi deployment

## Production contract

| Surface | Contract |
|---|---|
| Public URL | `https://bonifacio.work/garak/` |
| Public authentication | Bonifacio Authelia, minimum role `user` |
| Container image | `ghcr.io/facio313/garak:<40-character-commit-sha>` |
| Raspberry Pi origin | `127.0.0.1:5183` → container port `3000` |
| Readiness | `http://127.0.0.1:5183/garak/healthz` |
| Restricted deploy request | `deploy garak <40-character-commit-sha>` |
| Server Compose | `/etc/portfolio-deploy/garak.compose.yml` |
| Successful revision record | `/home/cks/.local/state/portfolio-deploy/garak.revision` |

The port is loopback-only. Do not publish port 3000 or 5183 on a non-loopback interface, and do not create an unauthenticated public health exception. The restricted deployer checks readiness directly on loopback.

Garak currently stores drafts only in each browser's local storage and does not consume `Remote-*` identity headers. Authelia protects the complete application surface, but the application does not treat those headers as an ownership assertion. If account-owned server data is introduced later, add a Garak-specific edge-to-origin secret and verify it together with the immutable central subject before trusting any identity header.

## Two build targets

The repository intentionally supports two hosting targets.

- Local development and OpenAI Sites use the default build. They run at `/` and retain the Sites/Cloudflare Vite plugins.
- The Raspberry Pi image sets `GARAK_SELF_HOSTED=1`. That build uses the native vinext Node output, sets `GARAK_BASE_PATH=/garak`, emits assets under `/garak/_next/`, and generates a standalone server.

`GARAK_PUBLIC_URL` controls canonical Open Graph, Twitter, icon, and sharing URLs. The production image sets it to `https://bonifacio.work/garak/`; the default remains the existing Sites origin. A base path must start with `/`, must not end with `/`, and may not contain `//` or `..`.

## GitHub Actions flow

`.github/workflows/ci.yml` runs for pull requests and the active development branches. It installs the lockfile with Node 22.23.2, validates the branch-bound authentication contract, lints, typechecks, builds, runs all tests, and validates the production Compose model.

`.github/workflows/deploy.yml` is a `workflow_run` consumer of `Validate` on `main`. It refuses pull-request and fork results, checks out the exact validated SHA, and requires that SHA to remain the current `main` head. A native GitHub-hosted ARM64 runner then:

1. builds `ghcr.io/facio313/garak:<sha>` with `main/sso` provenance labels;
2. starts that exact image as UID/GID `10001:10001`, with a read-only root filesystem, all capabilities dropped, and `no-new-privileges`;
3. verifies the image architecture, labels, revision, `/garak/healthz`, rendered HTML, canonical URL, prefixed assets, and the 404 outside `/garak`;
4. pushes only the smoke-tested immutable SHA tag;
5. sends the short-lived workflow token and actor through stdin to the restricted SSH channel and requests `deploy garak <sha>`.

The only required GitHub Repository Secret is `DEPLOY_KEY`. It must be the private half of the server's forced-command deployment key. Do not add a private registry token: the workflow-scoped `github.token` supplies package write/read permissions only for the duration of the run. The SSH host key is pinned in the workflow.

## First server registration

Perform these steps under the fleet deployment lock. They are bootstrap operations, not application container startup behavior.

1. Confirm the intended host port is unused with the server's read-only socket inventory. Stop if `127.0.0.1:5183` is already assigned.
2. Install this repository's `docker-compose.prod.yml` as `/etc/portfolio-deploy/garak.compose.yml`, owned and writable only by the operator. Validate it with `GARAK_IMAGE_TAG` set to an exact SHA and `PORTFOLIO_BRANCH=main`, `PORTFOLIO_AUTH_MODE=sso`.
3. Register exactly `deploy garak <40-character-lowercase-hex-sha>` in the forced-command dispatcher. Do not grant arbitrary shell access.
4. Add `deploy/bonifacio-nginx-location.conf` to the existing `bonifacio.work` HTTPS server block. Its `proxy_pass` intentionally has no trailing slash so `/garak` remains present when vinext receives the request.
5. Add `'^/garak(?:[/?].*)?$'` to Bonifacio's ordered `user` ACL before its matching deny rule, update the ACL contract test, and deploy the matching Bonifacio SSO image.
6. Install a Garak-specific deployment public key with `restrict` and the forced command `/usr/local/libexec/portfolio-deploy-garak`. The wrapper must accept only `deploy garak <sha>`, set `PORTFOLIO_DEPLOY_KEY_SCOPE=garak`, and delegate to the common dispatcher. Store only the corresponding private key as the Garak repository's `DEPLOY_KEY` secret; do not reuse a fleet-wide deployment key.
7. Run `nginx -t` before reloading Nginx. A failed validation must leave the previous effective configuration untouched.

The Nginx location includes `/etc/nginx/snippets/bonifacio-sso-authrequest.conf`, forwards to `127.0.0.1:5183`, preserves the prefix, and maps unavailable upstream responses to the portfolio maintenance page. There is no public bypass for `/garak/healthz`.

## Restricted deployer behavior

The server-side handler is part of the portfolio host, not this application repository. Its Garak case should follow this bounded sequence:

1. accept only a lowercase 40-character SHA and read exactly the expected token and actor lines from stdin;
2. take the fleet-wide deploy lock without stopping the current Garak container;
3. authenticate to GHCR without logging credentials and pull only `ghcr.io/facio313/garak:<sha>`;
4. verify `linux/arm64`, the OCI revision label, `main` branch label, and `sso` mode label;
5. record the currently healthy Garak SHA, then replace only the `garak` service;
6. wait for Docker health and fetch `http://127.0.0.1:5183/garak/healthz` plus the prefixed HTML and one hashed asset;
7. on failure, restore only the previous Garak SHA and prove its health before returning a failure exit status;
8. on success, atomically write `/home/cks/.local/state/portfolio-deploy/garak.revision` and log only non-secret release metadata.

Never run a global image/system prune, stack-wide `down`, or any volume deletion from the Garak handler. Garak is stateless on the server, but unrelated portfolio containers and durable data are outside its authority.

## Verification and rollback

After a successful deployment, verify all of the following:

```text
loopback GET  http://127.0.0.1:5183/garak/healthz  -> 200 JSON, no-store
anonymous GET https://bonifacio.work/garak/         -> SSO redirect
user GET      https://bonifacio.work/garak/         -> 200 Garak HTML
user GET      /garak/_next/static/<hashed-asset>    -> 200 immutable asset
public TCP    bonifacio.work:5183                    -> not reachable
```

Rollback is a redeploy of the last known healthy SHA-tagged image. Because drafts live in browser local storage, an image rollback does not migrate or delete server data. It also cannot recover drafts cleared by the browser; users should still export valuable scores. If the new image fails before cutover health succeeds, the deployer must automatically restore the previously recorded Garak image and leave the revision record unchanged.
