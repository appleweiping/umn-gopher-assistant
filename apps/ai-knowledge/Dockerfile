FROM python:3.14.6-slim-bookworm@sha256:86f975aca15cf04a40b399eebede9aea7c82eae084d1f1a0a6ef6bcaae871a30

ARG LIBCAP2_VERSION=1:2.66-4+deb12u3+b1
ARG LIBGNUTLS30_VERSION=3.7.9-2+deb12u7
ARG LIBSSL3_VERSION=3.0.20-1~deb12u2
ARG OPENSSL_VERSION=3.0.20-1~deb12u2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      "libcap2=${LIBCAP2_VERSION}" \
      "libgnutls30=${LIBGNUTLS30_VERSION}" \
      "libssl3=${LIBSSL3_VERSION}" \
      "openssl=${OPENSSL_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-deps --require-hashes --requirement requirements.txt \
    && addgroup --system --gid 10001 app \
    && adduser --system --uid 10001 --gid 10001 --home /nonexistent --no-create-home app

COPY --chown=10001:10001 ai_knowledge ./ai_knowledge

USER 10001:10001
EXPOSE 8081

CMD ["python", "-m", "uvicorn", "ai_knowledge.app:app", "--host", "0.0.0.0", "--port", "8081", "--no-server-header", "--no-proxy-headers"]
