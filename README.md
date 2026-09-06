# Codex server container

This image installs the Codex CLI but deliberately does not contain login credentials.
Authentication and Codex configuration are supplied at runtime through a mounted
`CODEX_HOME` directory.

The image also installs a managed `PreToolUse` hook that rejects common direct
write commands and `apply_patch` operations whose targets are outside `/workspace`.
The hook is an early policy check, not the security boundary: shell commands can
perform indirect writes that cannot be determined reliably from command text. The
Apptainer mount namespace and host bind permissions remain authoritative.

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
  codex-server --sandbox danger-full-access --ask-for-approval never
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

## Host wrapper scripts

This repository can also carry small host-side wrapper scripts for launching CLI
agents inside prebuilt Apptainer sandboxes. The wrappers are intended to be installed
somewhere on the user's `PATH` and named after the agent they start. For example,
the root-level `codex` wrapper launches the Codex sandbox, binds a selected repository
as `/workspace`, copies the user's Codex configuration into a temporary runtime
directory, and then starts the CLI inside the container.

The wrapper convention is intentionally tool-agnostic: future wrappers for other
agents, such as Claude or additional Codex variants, can follow the same model while
using their own sandbox path, configuration directory, and container entry command.
Each wrapper should keep credentials outside the image, bind only the target
repository, and treat the container or Apptainer mount namespace as the authoritative
isolation boundary.

For the included Codex wrapper, the Apptainer sandbox defaults to:

```bash
$HOME/.local/share/codex
```

Override it with `CODEX_SANDBOX` if the sandbox lives elsewhere:

```bash
CODEX_SANDBOX=/path/to/codex-sandbox codex /path/to/repo
```

## Workspace write hook

The hook policy is enforced through `/etc/codex/requirements.toml` in the image,
and its script is installed under `/opt/codex-hooks`. Because both paths are part
of the read-only Apptainer image, a workspace task cannot modify the policy.
The `server_run` target starts Codex with `danger-full-access` and approval prompts
disabled; the Apptainer container remains the outer isolation boundary.

The hook covers Codex shell and `apply_patch` tool calls. It blocks common explicit
outside-workspace targets and fails closed for dynamic targets on recognized write
commands. It does not inspect system calls or replace container isolation.

Run the policy tests with:

```bash
make test
```
