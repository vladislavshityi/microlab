# syntax=docker/dockerfile:1.7
# Сервис симуляции: супервизор сессий (Python + websockets) и microlab-sim-worker (Rust).
# Контекст сборки — корень репозитория: worker встраивает определения компонентов из
# packages/circuit-schema/definitions. BuildKit передаёт только перечисленные в COPY пути.

ARG BASE_IMAGE=python:3.13.15-slim-trixie@sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0
# Версия совпадает с simulation/rust-toolchain.toml; та же версия Debian, что у рабочего образа (glibc).
ARG RUST_IMAGE=rust:1.98.1-slim-trixie@sha256:f47a8de237dcbb0b0ce1099901e60a89728e3d51f24e664b40e947171538ade7

# --- Этап 1: сборка worker ---
FROM ${RUST_IMAGE} AS worker

# Toolchain уже в образе; rust-toolchain.toml дополнительно требует rustfmt/clippy, которые
# для сборки не нужны, поэтому версия задаётся переменной окружения.
ENV RUSTUP_TOOLCHAIN=1.98.1 \
    CARGO_TERM_COLOR=never

WORKDIR /src
COPY packages/circuit-schema/definitions packages/circuit-schema/definitions
COPY simulation/Cargo.toml simulation/Cargo.lock simulation/rust-toolchain.toml simulation/
COPY simulation/avr-core simulation/avr-core
COPY simulation/circuit simulation/circuit
COPY simulation/worker simulation/worker
# Манифесты ссылаются на тесты и примеры из этих каталогов.
COPY simulation/tests simulation/tests
COPY simulation/bench simulation/bench

WORKDIR /src/simulation
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/simulation/target \
    cargo build --release --locked -p microlab-sim-worker \
    && install -m 0755 target/release/microlab-sim-worker /usr/local/bin/microlab-sim-worker

# --- Этап 2: зависимости супервизора (единственный этап с pip) ---
FROM ${BASE_IMAGE} AS deps
COPY services/simulator/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary :all: \
       -r /tmp/requirements.txt

# --- Этап 3: рабочий образ ---
FROM ${BASE_IMAGE}

RUN groupadd --system --gid 10002 simulator \
    && useradd --system --uid 10002 --gid simulator --no-create-home --shell /usr/sbin/nologin simulator

COPY --from=deps /opt/venv /opt/venv
COPY --from=worker /usr/local/bin/microlab-sim-worker /usr/local/bin/microlab-sim-worker
COPY services/simulator/supervisor.py /app/supervisor.py

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SIM_WORKER=/usr/local/bin/microlab-sim-worker \
    SIM_PRLIMIT=/usr/bin/prlimit

USER 10002:10002
WORKDIR /app
EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
    CMD ["/opt/venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"]

CMD ["/opt/venv/bin/python", "/app/supervisor.py"]
