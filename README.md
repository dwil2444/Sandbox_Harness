# Codex server container

This image installs the Codex CLI but deliberately does not contain login credentials.
Authentication and Codex configuration are supplied at runtime through a mounted
`CODEX_HOME` directory.

## Build

```bash
docker build -t codex-server .
```

## Run with an external Codex directory

Replace `/secure/codex` with the directory containing the Codex authentication and
configuration files, and replace `/server/repos/project` with the repository to work on:

```bash
docker run --rm -it \
  --mount type=bind,src=/secure/codex,dst=/home/codex/.codex \
  --mount type=bind,src=/server/repos/project,dst=/workspace \
  --workdir /workspace \
  codex-server
```

The mounted Codex directory is intentionally external to the image. Do not commit it,
copy it into the image, or publish it to a registry.

## Optional Git SSH agent forwarding

If the repository needs SSH-based Git operations, the server can expose its SSH agent:

```bash
docker run --rm -it \
  --mount type=bind,src=/secure/codex,dst=/home/codex/.codex \
  --mount type=bind,src=/server/repos/project,dst=/workspace \
  --mount type=bind,src=$SSH_AUTH_SOCK,dst=/tmp/ssh-agent \
  --env SSH_AUTH_SOCK=/tmp/ssh-agent \
  --workdir /workspace \
  codex-server
```

Only mount the repository that Codex is meant to access. Do not mount the Docker socket
or the host root filesystem.
