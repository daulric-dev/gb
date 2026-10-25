# Self-hosted Postgres 18 with continuous WAL archiving (point-in-time
# recovery) through WAL-G. See infrastructure/BACKUPS.md.
#
# Why Alpine plus WAL-G built from source: WAL-G publishes only glibc (Ubuntu)
# binaries, and the GradeBook `db` service has always run postgres:*-alpine
# (musl), whose databases use the libc collation provider (en_US.utf8 on musl).
# Moving such a data directory to a glibc image changes text sort order and
# silently corrupts every btree index on text columns. Building WAL-G
# statically against musl keeps this image a drop-in replacement for
# postgres:18.6-alpine on an existing volume.
#
# Supply chain: the source tarball is pinned by SHA-256 and the Go module
# downloads are checked against go.sum (and the Go checksum database).
#
# Commands added to the image:
#   (default)          postgres with archive_mode=on, archive_command='wal-g wal-push %p'
#   walg-cron          base-backup scheduler (run as a sidecar with the data volume)
#   walg-basebackup    one base backup now, then retention (wal-g delete retain FULL N)
#   walg-restore       prepare an EMPTY data directory for point-in-time recovery
#   walg-health        sidecar health check
#   walg               wal-g with the checked settings (walg backup-list --detail)
#   wal-g              the WAL-G CLI itself

FROM golang:1.26.10-alpine3.24 AS walg
ARG WALG_VERSION=v3.0.9
ARG WALG_SOURCE_SHA256=b06bc26c4865c07d0c269101910f63c7eedd03790b7c054a7da0980a7a9cc31d
RUN apk add --no-cache build-base curl libsodium-dev libsodium-static
RUN set -eux; \
    curl -fsSLo /tmp/src.tar.gz "https://github.com/wal-g/wal-g/archive/refs/tags/${WALG_VERSION}.tar.gz"; \
    echo "${WALG_SOURCE_SHA256}  /tmp/src.tar.gz" | sha256sum -c -; \
    mkdir /src; tar -xzf /tmp/src.tar.gz -C /src --strip-components=1
WORKDIR /src/main/pg
# WAL-G 3.x needs encoding/json/v2 (GOEXPERIMENT=jsonv2, as its Makefile sets).
# Tags: libsodium = WALG_LIBSODIUM_KEY encryption. Static so it runs on musl
# without extra packages.
RUN set -eux; \
    GOEXPERIMENT=jsonv2 CGO_ENABLED=1 go build -trimpath -tags "libsodium" -o /out/wal-g \
      -ldflags "-s -w -linkmode external -extldflags -static -X github.com/wal-g/wal-g/cmd/pg.walgVersion=${WALG_VERSION}" .; \
    /out/wal-g --version

FROM postgres:18.6-alpine

ARG SUPERCRONIC_VERSION=v0.2.51
ARG SUPERCRONIC_SHA256_AMD64=cc232108374e8e2b537045f2d5eaa1229f619db314c3ba6a14d38b35dc0aa123
ARG SUPERCRONIC_SHA256_ARM64=4ae22576a78223d8ccdf5f3b3660a5cbb5288416bf0ca96afc4a36d195932b94
ARG TARGETARCH

RUN set -eux; \
    apk add --no-cache bash ca-certificates curl jq tzdata; \
    case "${TARGETARCH:-$(apk --print-arch)}" in \
      amd64|x86_64)  arch=amd64; sum="$SUPERCRONIC_SHA256_AMD64" ;; \
      arm64|aarch64) arch=arm64; sum="$SUPERCRONIC_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: ${TARGETARCH:-unknown}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/supercronic "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${arch}"; \
    echo "${sum}  /tmp/supercronic" | sha256sum -c -; \
    install -m 0755 /tmp/supercronic /usr/local/bin/supercronic; \
    rm /tmp/supercronic; \
    mkdir -p /run/walg; chown postgres:postgres /run/walg; chmod 0700 /run/walg

COPY --from=walg /out/wal-g /usr/local/bin/wal-g
COPY --chmod=0755 scripts/ /opt/walg/
RUN set -eux; \
    for s in entrypoint cron basebackup restore health; do ln -s "/opt/walg/$s.sh" "/usr/local/bin/walg-$s"; done; \
    ln -s /opt/walg/walg.sh /usr/local/bin/walg; \
    wal-g --version; supercronic -version

ENV WALG_STATE_DIR=/run/walg
ENTRYPOINT ["walg-entrypoint"]
CMD ["postgres"]
