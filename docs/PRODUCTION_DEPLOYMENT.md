# Production application deployment

This runbook deploys the WCIB application container to the DigitalOcean
Droplet. PostgreSQL remains a DigitalOcean managed service; production Compose
must never start a database container.

The current Milestone 2 deployment is private. The application is published
only on Droplet loopback at `127.0.0.1:5000`. Caddy is prepared behind the
optional `ingress` profile, but it must remain stopped until the client supplies
the production hostname and GoDaddy DNS is configured under STONE-77.

## Server layout

Root owns the production files:

- `/opt/wcib-dashboard/docker-compose.production.yml`
- `/opt/wcib-dashboard/deploy/Caddyfile`
- `/etc/wcib-dashboard/app.env` (`0600`)
- `/etc/wcib-dashboard/deployment.env` (`0600`)
- `/etc/wcib-dashboard/digitalocean-postgres-ca.crt` (`0644 root:root`)

`app.env` contains `NODE_ENV=production`, `PORT=5000`, the runtime-role managed
Postgres `DATABASE_URL`, and `SESSION_SECRET`. Its connection string uses the
private VPC hostname and
`sslrootcert=/run/secrets/digitalocean-postgres-ca.crt`. Do not put the migration
or `doadmin` connection string on the running application container.

The CA certificate is public verification material, not a credential. It must
remain root-owned and read-only in the container, but mode `0644` allows the
non-root `node` process to perform `verify-full` certificate validation. Keep
the environment files containing credentials at `0600`.

`deployment.env` pins the image selected for the release:

```text
WCIB_APP_IMAGE=wcib-dashboard:stone-75
```

## Build and transfer

Build the reviewed image from the repository root. The Dockerfile runs the
typechecks, complete non-database test suite, and client build before producing
the image.

```sh
docker build --tag wcib-dashboard:stone-75 .
docker image inspect wcib-dashboard:stone-75 --format '{{.Id}}'
docker image save --output /tmp/wcib-dashboard-stone-75.tar \
  wcib-dashboard:stone-75
```

Transfer the image archive and reviewed deployment files to the Droplet. Load
the archive with `docker image load`; do not clone or edit application source on
the server.

## Private rollout

Validate the rendered Compose model before changing containers:

```sh
docker compose \
  --env-file /etc/wcib-dashboard/deployment.env \
  --file /opt/wcib-dashboard/docker-compose.production.yml \
  config --services
```

The default service list may include the profile-defined `caddy` service in
configuration output, but this rollout starts only `app` explicitly. There is
no `db` service.

```sh
docker compose \
  --env-file /etc/wcib-dashboard/deployment.env \
  --file /opt/wcib-dashboard/docker-compose.production.yml \
  up --detach app
```

Confirm that the app is healthy, Postgres readiness succeeds, and no database
container exists:

```sh
docker compose \
  --env-file /etc/wcib-dashboard/deployment.env \
  --file /opt/wcib-dashboard/docker-compose.production.yml \
  ps
curl --fail --show-error http://127.0.0.1:5000/health
curl --fail --show-error http://127.0.0.1:5000/ready
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
```

Review startup logs for the safe `database_connection_established` and
`server_listening` events. Never copy connection strings, credentials, request
bodies, sessions, PII, or financial fields into deployment evidence.

An operator can verify the private endpoint without opening a public app port:

```sh
ssh -N -L 15500:127.0.0.1:5000 root@209.38.4.45
curl --fail --show-error http://127.0.0.1:15500/health
curl --fail --show-error http://127.0.0.1:15500/ready
```

## Restart and rollback

Exercise a restart and repeat both health checks:

```sh
docker compose \
  --env-file /etc/wcib-dashboard/deployment.env \
  --file /opt/wcib-dashboard/docker-compose.production.yml \
  restart app
```

For later releases, keep the prior immutable image tag loaded. Roll back by
changing only `WCIB_APP_IMAGE` in `deployment.env`, running `up --detach app`,
and repeating the private verification. On this first deployment there is no
prior application image; the safe backout is to stop `app` while preserving the
managed database and all server configuration.

## Deferred Caddy activation

STONE-77 owns the public ingress. After the client approves a hostname and its
DNS points at the reserved Droplet address:

1. Put `WCIB_HOSTNAME=<approved-hostname>` in a root-owned `0600` environment
   file.
2. Validate `deploy/Caddyfile` with the pinned Caddy image.
3. Open only ports 80 and 443 in the host and DigitalOcean firewalls.
4. Start the `ingress` profile and verify certificate issuance and external
   HTTPS health/readiness.

Do not activate Caddy with a placeholder hostname. Keep port 5000 bound to
loopback after Caddy is enabled; Caddy reaches `app:5000` over the private
Compose network.

## Milestone 2 deployment record

The private deployment gate ran on July 10, 2026 with these results:

- App image: `wcib-dashboard:stone-75`, `linux/amd64`, image ID
  `sha256:10951a83321988aba1cb771783c66a28deaf49f0ddaf6ee1de8574d95c22215d`.
- Image build: `npm run check`, 216 non-database tests, and the production
  client build passed inside the Docker build.
- Runtime: non-root `node`, read-only root filesystem, all Linux capabilities
  dropped, `no-new-privileges`, and `unless-stopped` restart policy.
- Database: the `wcib_runtime` role connected over the private VPC hostname
  with `sslmode=verify-full` and the mounted DigitalOcean CA.
- Health: Droplet-local `/health` and `/ready` returned 200 before and after a
  controlled container restart.
- Operator path: SSH stdio forwarding to Droplet loopback returned HTTP 200 and
  the minimal `{"status":"ok"}` response for `/health` without opening a port.
- Security regression: 12 focused login, password-only MFA-off, and
  default-closed route-registration tests passed from the deployed image.
- Logs: startup emitted only the sanitized database-connected and
  server-listening events; the credential-pattern scan returned zero matches.
- Isolation: production ran one app container, no Postgres container existed,
  port 5000 was bound to `127.0.0.1`, its public address was unreachable, and
  UFW continued to allow only OpenSSH.
- Caddy: the digest-pinned `2.10.2-alpine` image validated the prepared
  Caddyfile successfully with networking disabled. The Caddy service was not
  started.

Public DNS, certificate issuance, public HTTPS checks, and Caddy activation are
deferred to STONE-77 under the Launch milestone.
