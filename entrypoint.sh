#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d "${CODEX_HOME:-/home/codex/.codex}" ]]; then
  echo "Codex home is missing: ${CODEX_HOME:-/home/codex/.codex}" >&2
  echo "Mount your Codex configuration/authentication directory at that path." >&2
  exit 1
fi

exec codex "$@"
