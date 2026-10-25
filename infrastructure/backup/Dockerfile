# Daily encrypted logical backup of the GradeBook Postgres database.
#
#   pg_dump (Postgres 18 client) | age (encrypt) -> S3-compatible bucket (rclone)
#
# Scheduled by supercronic (BACKUP_SCHEDULE, default "0 4 * * *" in TZ, default
# UTC). Works against any Postgres the client can reach: managed or the
# self-hosted `db` service. See infrastructure/BACKUPS.md.
#
# Commands (see scripts/):
#   backup-cron      default: check config, then run the schedule
#   backup-now       one backup, now (dump, encrypt, upload, prune)
#   backup-restore   download -> verify sha256 -> decrypt -> pg_restore
#   backup-verify    restore the latest backup into a throwaway database and check it
#   backup-list      list backups in the bucket
#   backup-rclone    rclone with the backup remote ("backup:") configured
#   backup-health    container health check (last success is recent)
#
# The client major version must be >= the server's (pg_dump refuses a newer
# server). Bump the base image together with the database.
FROM postgres:18.6-alpine

# Pinned tool versions. Checksums are SHA-256 of the release assets; the
# supercronic SHA-1s published in its release notes were checked to match, and
# the rclone sums match its signed SHA256SUMS file.
ARG SUPERCRONIC_VERSION=v0.2.51
ARG SUPERCRONIC_SHA256_AMD64=cc232108374e8e2b537045f2d5eaa1229f619db314c3ba6a14d38b35dc0aa123
ARG SUPERCRONIC_SHA256_ARM64=4ae22576a78223d8ccdf5f3b3660a5cbb5288416bf0ca96afc4a36d195932b94
ARG AGE_VERSION=v1.3.2
ARG AGE_SHA256_AMD64=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
ARG AGE_SHA256_ARM64=6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4
ARG RCLONE_VERSION=v1.75.2
ARG RCLONE_SHA256_AMD64=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
ARG RCLONE_SHA256_ARM64=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10
# Set automatically by BuildKit (docker build / compose build).
ARG TARGETARCH

RUN set -eux; \
    apk add --no-cache bash ca-certificates coreutils curl jq tini tzdata; \
    case "${TARGETARCH:-$(apk --print-arch)}" in \
      amd64|x86_64)  arch=amd64; sc_sum="$SUPERCRONIC_SHA256_AMD64"; age_sum="$AGE_SHA256_AMD64"; rc_sum="$RCLONE_SHA256_AMD64" ;; \
      arm64|aarch64) arch=arm64; sc_sum="$SUPERCRONIC_SHA256_ARM64"; age_sum="$AGE_SHA256_ARM64"; rc_sum="$RCLONE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: ${TARGETARCH:-unknown}" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; cd "$tmp"; \
    curl -fsSLo supercronic "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${arch}"; \
    echo "${sc_sum}  supercronic" | sha256sum -c -; \
    install -m 0755 supercronic /usr/local/bin/supercronic; \
    curl -fsSLo age.tar.gz "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-${arch}.tar.gz"; \
    echo "${age_sum}  age.tar.gz" | sha256sum -c -; \
    tar -xzf age.tar.gz; \
    install -m 0755 age/age age/age-keygen /usr/local/bin/; \
    curl -fsSLo rclone.zip "https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${arch}.zip"; \
    echo "${rc_sum}  rclone.zip" | sha256sum -c -; \
    unzip -q rclone.zip; \
    install -m 0755 "rclone-${RCLONE_VERSION}-linux-${arch}/rclone" /usr/local/bin/rclone; \
    cd /; rm -rf "$tmp"; \
    supercronic -version; age --version; rclone version | head -1; pg_dump --version

COPY --chmod=0755 scripts/ /opt/backup/
RUN set -eux; \
    ln -s /opt/backup/cron.sh    /usr/local/bin/backup-cron; \
    ln -s /opt/backup/backup.sh  /usr/local/bin/backup-now; \
    ln -s /opt/backup/restore.sh /usr/local/bin/backup-restore; \
    ln -s /opt/backup/verify.sh  /usr/local/bin/backup-verify; \
    ln -s /opt/backup/list.sh    /usr/local/bin/backup-list; \
    ln -s /opt/backup/rclone.sh  /usr/local/bin/backup-rclone; \
    ln -s /opt/backup/health.sh  /usr/local/bin/backup-health; \
    mkdir -p /work /run/backup; \
    chown postgres:postgres /work /run/backup; \
    chmod 0700 /work /run/backup

ENV TZ=UTC \
    BACKUP_WORK_DIR=/work \
    BACKUP_STATE_DIR=/run/backup \
    RCLONE_CONFIG=/dev/null

# The image's `postgres` user (uid/gid 70); no root needed at run time.
USER postgres
WORKDIR /work
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["backup-cron"]
HEALTHCHECK --interval=5m --timeout=10s --start-period=1m --retries=1 CMD ["backup-health"]
