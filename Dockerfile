FROM node:22-bookworm-slim

ARG CODEX_VERSION=latest

ENV CODEX_HOME=/home/codex/.codex
ENV PATH="/home/codex/.local/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
        git \
        openssh-client \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && useradd --create-home --shell /bin/bash codex \
    && mkdir -p /home/codex/.codex /workspace \
    && chown -R codex:codex /home/codex /workspace \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/codex-container
COPY codex-policy/workspace-write-guard.mjs /opt/codex-hooks/workspace-write-guard.mjs
COPY codex-policy/requirements.toml /etc/codex/requirements.toml
RUN chmod 0755 \
        /usr/local/bin/codex-container \
        /opt/codex-hooks/workspace-write-guard.mjs

USER codex
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/codex-container"]
