# DigitalOcean Infrastructure

This runbook records the Milestone 2 production foundation. It contains no
passwords, connection strings, session secrets, SSH private keys, or trusted
source addresses.

## Resource inventory

| Resource | Configuration |
| --- | --- |
| Region | SFO3 |
| VPC | `default-sfo3` |
| App Droplet | `home`, Ubuntu 26.04 LTS, 2 vCPU, 2 GB RAM, 90 GB disk |
| Container runtime | Ubuntu `docker.io` 29.1.3 and Compose 2.40.3 |
| Managed database cluster | `igotabigdb`, Standard PostgreSQL 18, primary-only, 1 vCPU, 1 GB RAM, 15 GiB disk |
| Application database | `wcib` |
| Runtime database role | `wcib_runtime` |
| Migration database role | `wcib_migrator` |
| Public ingress | Assigned reserved IPv4 and IPv6 addresses; DNS is deferred |
| Resource owner | WCIB DigitalOcean account owner |

DigitalOcean monitoring agents and Docker are enabled at boot. Production does
not run a PostgreSQL container. The host firewall is enabled at boot with a
default-deny incoming policy; only key-only SSH is currently allowed.

## Network boundary

- The app connects to managed PostgreSQL on port 25060 through the cluster's
  private VPC hostname. The Droplet and cluster are in the same region and VPC.
- Operator access from a trusted workstation uses the public cluster hostname.
  The workstation must be an explicit database trusted source.
- PostgreSQL connections use `sslmode=verify-full` and the cluster CA. TLS
  hostname verification has been proven from both the operator workstation and
  the Droplet VPC path.
- Database trusted sources must contain only reviewed operator or DigitalOcean
  resources. Never allow `0.0.0.0/0` or `::/0`.
- The reviewed list contains one named operator Mac IPv4 source and the `home`
  Droplet resource. DigitalOcean denies every source not on that list.
- SSH uses public-key authentication, a maximum of three authentication
  attempts, and no X11 forwarding. Password authentication is disabled.
  UFW is the active Droplet firewall with default-deny inbound policy and only
  OpenSSH allowed. No DigitalOcean Cloud Firewall is attached; do not stack one
  on top of UFW. A later switch must create and verify the Cloud Firewall before
  disabling UFW.
- The reserved public addresses are for future web ingress. They are not used
  in `DATABASE_URL`.

## Credentials and files

The long-running app receives only the runtime database role. Migration
credentials are loaded only for a migration gate and are not placed in the app
container or its long-running environment.

Before the first migration, connect to `wcib` as `doadmin` and establish the
role boundary:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE wcib TO wcib_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO wcib_migrator;
GRANT CONNECT ON DATABASE wcib TO wcib_runtime;
GRANT USAGE ON SCHEMA public TO wcib_runtime;
REVOKE CREATE ON DATABASE wcib FROM wcib_runtime;
REVOKE CREATE ON SCHEMA public FROM wcib_runtime;
```

Then connect as `wcib_migrator` and define privileges for objects it will own:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wcib_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wcib_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON TYPES TO wcib_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO wcib_runtime;
```

`wcib_runtime` must retain `CONNECT` and `USAGE` while returning false for
database `CREATE` and schema `CREATE`. `wcib_migrator` must return true for
both creation checks before the migration gate begins. Neither role is a
PostgreSQL superuser.

| Purpose | Location | Required mode |
| --- | --- | --- |
| Production app environment | `/etc/wcib-dashboard/app.env` | `0600 root:root` |
| Persistent managed DB CA | `/etc/wcib-dashboard/digitalocean-postgres-ca.crt` | `0644 root:root` |
| Container CA mount | `/run/secrets/digitalocean-postgres-ca.crt` | Read-only |
| Operator managed-DB environment | Ignored `.env.managed.local` | `0600` |
| Operator migration environment | Ignored `.env.production-migrate.local` | `0600` |

The repository ignores `.env.*` and `.secrets/`. The Docker build context also
excludes both, preventing local credentials and certificates from being copied
into an image layer. The CA certificate is a public trust anchor rather than a
secret, so it is root-owned but world-readable for the non-root app process.

## Managed durability

Before any production migration, verify in the DigitalOcean control plane that:

1. Automated backups are active for `igotabigdb`.
2. Point-in-time recovery is available and its retention window is recorded in
   the migration evidence.
3. The recovery owner can access the cluster without sharing `doadmin` with the
   application.
4. A recovery checkpoint is available immediately before the schema apply.

The control plane exposes `Restore from backup` for `igotabigdb`. DigitalOcean
Managed PostgreSQL takes a full backup daily, retains backups for seven days,
and maintains write-ahead logs for point-in-time recovery within that window.
See DigitalOcean's
[PostgreSQL backup documentation](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/).
Managed backups complement the migration backout procedure. They do not replace
the forward, rollback, and failure-injection proof required before schema apply.

## Provisioning verification

The following checks are required before the provisioning ticket closes:

- Local Compose starts only the separate `app` and `db` services, and the app
  reaches local PostgreSQL by the `db` service name.
- The same app image builds with checks, tests, and the production client bundle.
- The local runtime role reaches the managed database through the public TLS
  endpoint without exposing credentials in output.
- The Droplet reaches the private managed endpoint with CA and hostname
  verification.
- The managed database trusted-source list and Droplet firewall contain no
  world-open database rule.
- No application or Core Schema migration is deployed during provisioning.

## Backout

Provisioning can be backed out only while the resources contain no production
data. Once production data exists, preserve the managed database and use the
reviewed migration/PITR procedures. Removing the app container or replacing the
Droplet must not delete or recreate the managed database.
