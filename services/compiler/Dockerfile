# syntax=docker/dockerfile:1.7
# Воркер компиляции Arduino-скетчей: arduino-cli + arduino:avr 1.8.8, без сети во время работы.

ARG BASE_IMAGE=python:3.13.15-slim-trixie@sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0

# --- Этап 1: загрузка и проверка toolchain (единственный этап с доступом в сеть) ---
FROM ${BASE_IMAGE} AS toolchain

ARG TARGETARCH
ARG ARDUINO_CLI_VERSION=1.5.1
# SHA-256 из официального файла 1.5.1-checksums.txt релиза arduino-cli.
ARG ARDUINO_CLI_SHA256_AMD64=28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b
ARG ARDUINO_CLI_SHA256_ARM64=1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62
# SHA-256 архива avr-1.8.8.tar.bz2 из package_index.json.
ARG ARDUINO_AVR_SHA256=a234c2a43dcd01ce54be665806f183b8e6ec4e966d2e3e0c3358b63023d6390c

WORKDIR /build
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) asset=Linux_64bit; sha="${ARDUINO_CLI_SHA256_AMD64}" ;; \
      arm64) asset=Linux_ARM64; sha="${ARDUINO_CLI_SHA256_ARM64}" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_${asset}.tar.gz"; \
    python -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], "cli.tar.gz")' "$url"; \
    echo "${sha}  cli.tar.gz" | sha256sum -c -; \
    tar -xzf cli.tar.gz arduino-cli; \
    install -m 0755 arduino-cli /usr/local/bin/arduino-cli; \
    arduino-cli version

COPY arduino-cli.yaml sketch.yaml /opt/arduino/
COPY warmup.ino /build/sketch/sketch.ino

# Сборка с профилем устанавливает платформу и toolchain ровно тех версий, что указаны
# в sketch.yaml (arduino-cli проверяет контрольные суммы по package_index.json).
# Затем дополнительно сверяется SHA-256 архива ядра.
RUN set -eu; \
    mkdir -p /opt/arduino/data /opt/arduino/downloads /opt/arduino/user; \
    cp /opt/arduino/sketch.yaml /build/sketch/sketch.yaml; \
    arduino-cli --config-file /opt/arduino/arduino-cli.yaml compile \
      --profile uno --build-path /build/out /build/sketch; \
    echo "${ARDUINO_AVR_SHA256}  /opt/arduino/downloads/packages/avr-1.8.8.tar.bz2" | sha256sum -c -; \
    test -d /opt/arduino/data/internal/arduino_avr_1.8.8_*; \
    rm -rf /opt/arduino/downloads/* /opt/arduino/data/tmp

# --- Этап 2: рабочий образ ---
FROM ${BASE_IMAGE}

ARG ARDUINO_CLI_VERSION=1.5.1

RUN groupadd --system --gid 10001 compiler \
    && useradd --system --uid 10001 --gid compiler --no-create-home --shell /usr/sbin/nologin compiler \
    && mkdir -p /work && chown compiler:compiler /work && chmod 0700 /work

COPY --from=toolchain /usr/local/bin/arduino-cli /usr/local/bin/arduino-cli
COPY --from=toolchain /opt/arduino /opt/arduino
COPY compile_worker.py /app/compile_worker.py

ENV COMPILER_ARDUINO_CLI_VERSION=${ARDUINO_CLI_VERSION} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER 10001:10001
WORKDIR /app
EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"]

CMD ["python", "/app/compile_worker.py"]
