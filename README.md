# Agent sandbox harness

Build and install coding-agent CLIs in Apptainer SIF images. Codex is the default;
GitHub Copilot CLI is also supported. Credentials stay outside the images.

## Layout

```text
agents/
  codex/
    agent.mk
    codex.def
    launcher
    entrypoint.sh
    policy/
      requirements.toml
      workspace-write-guard.mjs
  copilot/
    agent.mk
    copilot.def
    launcher
Makefile
tests/
```

The Makefile shares build and installation logic. Each agent owns its definition,
standalone launcher, version settings, and any policy files. Copilot does not
install the Codex-specific hook.

## Build and install

Run from the repository root with Apptainer available on your PATH:

```bash
make build                         # creates ./codex.sif
make build AGENT=copilot            # creates ./copilot.sif
```

On the server, build and install the selected image and launcher:

```bash
make server_build                  # ~/.local/share/codex.sif and ~/bin/codex
make server_build AGENT=copilot     # ~/.local/share/copilot.sif and ~/bin/copilot
```

`server_build` loads the Apptainer environment module if needed. It retains the
built SIF in the repository and copies the standalone launcher to `~/bin` with
executable permissions. Ensure `~/bin` is on your PATH. `slurm_build` is an alias
for `server_build`.

Choose a version with `AGENT_VERSION`; existing agent-specific version variables
also work:

```bash
make build AGENT=copilot AGENT_VERSION='<version>'
make build CODEX_VERSION='<version>'
make build AGENT=copilot COPILOT_VERSION='<version>'
```

`IMAGE` overrides the output basename. `SLURM_SANDBOX` overrides the installed
image path (the legacy variable name now refers to a SIF file):

```bash
make server_build AGENT=copilot SLURM_SANDBOX=/path/to/copilot.sif
AGENT_SANDBOX=/path/to/copilot.sif ~/bin/copilot /path/to/repo
```

Custom image paths must also be supplied when launching; copying a launcher does
not bake the build machine's paths into it. `make server_run` passes
`SLURM_SANDBOX` automatically.

Direct builds are also possible:

```bash
apptainer build --fakeroot codex.sif agents/codex/codex.def
apptainer build --fakeroot copilot.sif agents/copilot/copilot.def
```

`Bootstrap: docker` downloads the base image from a registry; Docker is not
required. Builds need network access and a host that supports Apptainer fakeroot.
If the cluster disables builds, build on another compatible Apptainer host and
transfer the SIF file. Images are read-only; rebuild to update installed tools.
The bound repository and temporary runtime configuration are writable.

## Launch

After `server_build`:

```bash
~/bin/codex /path/to/repo
~/bin/copilot /path/to/repo
make server_run AGENT=copilot REPO_DIR=/path/to/repo
```

Launchers use the current directory if no initial directory argument is supplied,
and forward remaining arguments to the CLI. They load the Apptainer module if
Apptainer is not already available. Both use `--containall --cleanenv`, mount the
selected repository at `/workspace`, and run there.

For a local build that has not been installed:

```bash
AGENT_SANDBOX="$PWD/codex.sif" ./agents/codex/launcher /path/to/repo
AGENT_SANDBOX="$PWD/copilot.sif" ./agents/copilot/launcher /path/to/repo
```

`AGENT_SANDBOX` overrides either launcher's image. `CODEX_SANDBOX` and
`COPILOT_SANDBOX` also work for their respective agents.

## Configuration and authentication

The Codex launcher copies `${CODEX_HOME:-$HOME/.codex}` into a temporary runtime
directory mounted at `/home/codex/.codex`. The Copilot launcher similarly copies
`${COPILOT_HOME:-$HOME/.copilot}` to `/home/copilot/.copilot`. SQLite files and IPC
state are excluded. Temporary directories are removed when the CLI exits;
configuration changes and new login/session state are not copied back to the host.

Copilot's extraction cache is also placed inside its writable temporary runtime
directory using `XDG_CACHE_HOME` and `COPILOT_CACHE_HOME`. Its build test uses a
separate temporary configuration and cache, so it does not depend on `/root` or
write into the read-only image. Setting `COPILOT_HOME` alone does not relocate
the cache; see GitHub's
[cache directory documentation](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference).

Copilot supports `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN` in that
precedence order. Its launcher explicitly forwards these variables through
Apptainer's clean environment, without placing tokens in command arguments.
A fine-grained personal access token needs the Copilot Requests permission.
Host keychain credentials are not copied by copying `~/.copilot`; use a supported
token or authenticate inside the session if needed. See GitHub's
[installation and authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).

Credentials are never included in the definitions. Do not commit configuration
or token files or add them to an image's `%files` section.

For persistent configuration instead of a temporary copy, explicitly bind an
external directory when running the image directly. For example:

```bash
apptainer run --containall --cleanenv \
  --bind /secure/codex:/home/codex/.codex \
  --bind /server/repos/project:/workspace \
  --pwd /workspace \
  "$HOME/.local/share/codex.sif" --sandbox danger-full-access --ask-for-approval never
```

For SSH Git operations, add `--bind "$SSH_AUTH_SOCK:/tmp/ssh-agent"` and
`--env SSH_AUTH_SOCK=/tmp/ssh-agent` before the image argument. The launchers do
not forward the SSH agent automatically.

## Permissions and hooks

The Codex launcher uses `--sandbox danger-full-access --ask-for-approval never`.
Copilot uses `--allow-all`. Apptainer's mount namespace and host bind permissions
provide the outer isolation boundary. Only bind the repository and configuration
that the agent needs; do not bind the host root filesystem.

Codex's definition installs `agents/codex/policy/requirements.toml` at
`/etc/codex/requirements.toml` and its guard at
`/opt/codex-hooks/workspace-write-guard.mjs`. The configuration registers a managed
`PreToolUse` hook for `Bash` and `apply_patch`. The guard rejects recognized direct
writes outside `/workspace` and dynamic targets it cannot verify. It is an early
policy check, not a replacement for container isolation.

The build checks hook syntax and configuration-file presence; these checks do not
prove that a particular Codex release loads and invokes the hook. Copilot has no
equivalent managed write hook configured by this repository.

## Add another agent

Create `agents/<name>/<name>.def`, an executable standalone `launcher`, and
`agent.mk`. The latter defines `AGENT_VERSION` and `VERSION_ARG`, which names the
definition's build argument. Follow the existing agents for examples. Keep CLI
flags, authentication handling, and policy integration specific to the agent.
The Makefile discovers agents from these `agent.mk` files; no shared build changes
are required. Claude is not implemented yet.

## Checks

```bash
make test
```

Policy tests exercise the Codex guard. Workflow tests use mocked Apptainer commands;
full image builds and authenticated sessions must be checked on an Apptainer host.
