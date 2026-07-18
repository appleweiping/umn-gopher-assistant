# syntax=docker/dockerfile:1.7

# PostGIS publishes this image from its official docker-postgis repository. The digest makes the
# PostgreSQL 17 + PostGIS 3.5 base immutable; update it only with an explicit dependency review.
FROM postgis/postgis:17-3.5@sha256:4e8c30197f7ce4190cf11a1b8c44bea35a58507558cffa48570814beba77b099

ARG PGVECTOR_VERSION=0.8.2
ARG PGVECTOR_SHA256=69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa

LABEL org.opencontainers.image.title="UMN Gopher Assistant development PostgreSQL" \
      org.opencontainers.image.description="PostgreSQL 17 with PostGIS 3.5 and pgvector 0.8.2" \
      org.opencontainers.image.source="https://github.com/pgvector/pgvector"

ADD --checksum=sha256:69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa \
    https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.2.tar.gz /tmp/pgvector.tar.gz

RUN set -eux; \
    echo "${PGVECTOR_SHA256}  /tmp/pgvector.tar.gz" | sha256sum --check --strict; \
    apt-get update; \
    apt-mark hold locales; \
    apt-get install -y --no-install-recommends build-essential ca-certificates postgresql-server-dev-17; \
    mkdir /tmp/pgvector; \
    tar --extract --gzip --file /tmp/pgvector.tar.gz --directory /tmp/pgvector --strip-components=1; \
    make -C /tmp/pgvector clean; \
    make -C /tmp/pgvector OPTFLAGS=""; \
    make -C /tmp/pgvector install; \
    mkdir -p /usr/share/doc/pgvector; \
    cp /tmp/pgvector/LICENSE /tmp/pgvector/README.md /usr/share/doc/pgvector/; \
    grep -Fq "default_version = '${PGVECTOR_VERSION}'" /usr/share/postgresql/17/extension/vector.control; \
    rm -rf /tmp/pgvector /tmp/pgvector.tar.gz; \
    apt-get purge -y --auto-remove build-essential postgresql-server-dev-17; \
    apt-mark unhold locales; \
    rm -rf /var/lib/apt/lists/*
