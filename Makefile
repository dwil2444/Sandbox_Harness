IMAGE ?= codex
CODEX_VERSION ?= latest
SLURM_SANDBOX ?= $(HOME)/.local/share/$(IMAGE).sif
REPO_DIR ?= $(CURDIR)

.PHONY: build test slurm_build server_build server_run

test:
	node --test tests/*.test.mjs

# Apptainer must already be available on PATH (module load apptainer on HPC).
build:
	mkdir -p "$(dir $(SLURM_SANDBOX))"
	apptainer build --fakeroot --build-arg "CODEX_VERSION=$(CODEX_VERSION)" "$(SLURM_SANDBOX)" codex.def

# UVA/SLURM build: run from this repository on the server.
server_build:
	bash -lc 'module load apptainer && $(MAKE) build'

slurm_build: server_build

server_run:
	CODEX_SANDBOX="$(SLURM_SANDBOX)" ./codex "$(REPO_DIR)"
