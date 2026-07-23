# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

# PostGIS publishes this image from its official docker-postgis repository. The digest makes the
# PostgreSQL 17 + PostGIS 3.5 Alpine base immutable; update it only with an explicit dependency review.
FROM postgis/postgis:17-3.5-alpine@sha256:bcab61c139a9644dcf0bb00b0cff8ab84e36b3b6f74983cf229ddb4ea0c22897 AS pgvector-builder

ARG PGVECTOR_VERSION=0.8.2
ARG PGVECTOR_SHA256=69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa
ARG BUILD_BASE_VERSION=0.5-r4
ARG CLANG_VERSION=21.1.8-r3
ARG LLVM_VERSION=21.1.8-r1

ADD --checksum=sha256:69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa \
    https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.2.tar.gz /tmp/pgvector.tar.gz

RUN set -eux; \
    echo "${PGVECTOR_SHA256}  /tmp/pgvector.tar.gz" | sha256sum -c -; \
    apk add --no-cache --virtual .build-deps \
      "build-base=${BUILD_BASE_VERSION}" \
      "clang21=${CLANG_VERSION}" \
      "llvm21=${LLVM_VERSION}"; \
    mkdir /tmp/pgvector; \
    tar --extract --gzip --file /tmp/pgvector.tar.gz --directory /tmp/pgvector --strip-components=1; \
    make -C /tmp/pgvector clean; \
    make -C /tmp/pgvector OPTFLAGS=""; \
    make -C /tmp/pgvector install; \
    mkdir -p /usr/share/doc/pgvector; \
    cp /tmp/pgvector/LICENSE /tmp/pgvector/README.md /usr/share/doc/pgvector/; \
    grep -Fq "default_version = '${PGVECTOR_VERSION}'" /usr/local/share/postgresql/extension/vector.control

FROM postgis/postgis:17-3.5-alpine@sha256:bcab61c139a9644dcf0bb00b0cff8ab84e36b3b6f74983cf229ddb4ea0c22897 AS runtime

ARG SU_EXEC_VERSION=0.3-r0

RUN set -eux; \
    apk add --no-cache "su-exec=${SU_EXEC_VERSION}"; \
    cp /sbin/su-exec /usr/local/bin/gosu; \
    cmp -s /sbin/su-exec /usr/local/bin/gosu; \
    gosu postgres id -u | grep -Fx '70'; \
    ! command -v gcc; \
    ! command -v clang-21

COPY --from=pgvector-builder /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=pgvector-builder /usr/local/lib/postgresql/bitcode/vector /usr/local/lib/postgresql/bitcode/vector
COPY --from=pgvector-builder /usr/local/lib/postgresql/bitcode/vector.index.bc /usr/local/lib/postgresql/bitcode/vector.index.bc
COPY --from=pgvector-builder /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
COPY --from=pgvector-builder /usr/share/doc/pgvector /usr/share/doc/pgvector

# Flatten the sanitized runtime filesystem so scanners and registries cannot
# retain the vulnerable Go-built helper hidden in a lower parent-image layer.
FROM scratch AS final

COPY --from=runtime / /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.utf8 \
    PG_MAJOR=17 \
    PG_VERSION=17.10 \
    PGDATA=/var/lib/postgresql/data \
    POSTGIS_VERSION=3.5.7 \
    SU_EXEC_VERSION=0.3-r0

LABEL org.opencontainers.image.title="UMN Gopher Assistant development PostgreSQL" \
      org.opencontainers.image.description="PostgreSQL 17 with PostGIS 3.5 and pgvector 0.8.2" \
      org.opencontainers.image.source="https://github.com/pgvector/pgvector"

VOLUME ["/var/lib/postgresql/data"]
USER 70:70
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
EXPOSE 5432
STOPSIGNAL SIGINT
