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

Build directly with Apptainer from the repository root. Docker is not required:
`Bootstrap: docker` in `codex.def` downloads the base image from Docker Hub.
The definition installs the CLI, entrypoint, and managed policy hook without
including credentials.

On a server that provides Apptainer through environment modules:

```bash
make server_build
```

If Apptainer is already on your `PATH`, use `make build` instead. Both build a
SIF image at `$HOME/.local/share/codex.sif`. `make slurm_build` is an alias
for `make server_build`.

To select a CLI version or a different output file:

```bash
make server_build CODEX_VERSION='<version>' SLURM_SANDBOX=/path/to/codex.sif
```

The equivalent direct build command is:

```bash
mkdir -p "$HOME/.local/share"
apptainer build --fakeroot "$HOME/.local/share/codex.sif" codex.def
```

The build needs network access to the image registry, Debian repositories, and
npm, plus support for Apptainer's fakeroot mode on the build host. If the cluster
disables unprivileged builds, build on another Apptainer host with a compatible
architecture and transfer the resulting `.sif` file. No Docker archive is needed.

The SIF image contains a compressed, read-only container filesystem. The bound
repository and runtime configuration remain writable. To update installed tools,
rebuild the image from `codex.def`.

After building, launch against a selected repository:

```bash
./codex /path/to/repo
# Or:
make server_run REPO_DIR=/path/to/repo
```

## Run with an external Codex directory

Replace `/secure/codex` with the directory containing the Codex authentication and
configuration files, and replace `/server/repos/project` with the repository to work on:

```bash
apptainer run --containall --cleanenv \
  --bind /secure/codex:/home/codex/.codex \
  --bind /server/repos/project:/workspace \
  --pwd /workspace \
  "$HOME/.local/share/codex.sif" --sandbox danger-full-access --ask-for-approval never
```

The mounted Codex directory is intentionally external to the image. Do not commit it,
copy it into the image, or publish it to a registry.

## Optional Git SSH agent forwarding

If the repository needs SSH-based Git operations, the server can expose its SSH agent:

```bash
apptainer run --containall --cleanenv \
  --bind /secure/codex:/home/codex/.codex \
  --bind /server/repos/project:/workspace \
  --bind "$SSH_AUTH_SOCK:/tmp/ssh-agent" \
  --env SSH_AUTH_SOCK=/tmp/ssh-agent \
  --pwd /workspace \
  "$HOME/.local/share/codex.sif" --sandbox danger-full-access --ask-for-approval never
```

Only mount the repository that Codex is meant to access. Do not mount the host
root filesystem.

## Host wrapper scripts

This repository can also carry small host-side wrapper scripts for launching CLI
agents inside prebuilt Apptainer SIF images. The wrappers are intended to be installed
somewhere on the user's `PATH` and named after the agent they start. For example,
the root-level `codex` wrapper launches the Codex image, binds a selected repository
as `/workspace`, copies the user's Codex configuration into a temporary runtime
directory, and then starts the CLI inside the container.

The wrapper convention is intentionally tool-agnostic: future wrappers for other
agents, such as Claude or additional Codex variants, can follow the same model while
using their own image path, configuration directory, and container entry command.
Each wrapper should keep credentials outside the image, bind only the target
repository, and treat the container or Apptainer mount namespace as the authoritative
isolation boundary.

For the included Codex wrapper, the Apptainer image defaults to:

```bash
$HOME/.local/share/codex.sif
```

Override it with `CODEX_SANDBOX` if the image lives elsewhere. The existing
`CODEX_SANDBOX` and Makefile `SLURM_SANDBOX` variable names are retained, but now
refer to SIF files:

```bash
CODEX_SANDBOX=/path/to/codex.sif codex /path/to/repo
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
