IMAGE ?= codex
CODEX_VERSION ?= latest
SLURM_SANDBOX ?= $(HOME)/.local/share/$(IMAGE).sif
REPO_DIR ?= $(CURDIR)

.PHONY: build test slurm_build server_build server_run

test:
	node --test tests/*.test.mjs

# Apptainer must already be available on PATH (module load apptainer on HPC).
build:
	apptainer build --fakeroot --build-arg "CODEX_VERSION=$(CODEX_VERSION)" "$(CURDIR)/$(IMAGE).sif" codex.def

# UVA/SLURM build: run from this repository on the server.
server_build:
	bash -lc 'module load apptainer && $(MAKE) build'
	mkdir -p "$(dir $(SLURM_SANDBOX))" "$(HOME)/bin"
	install -m 0644 "$(CURDIR)/$(IMAGE).sif" "$(SLURM_SANDBOX)"
	install -m 0755 codex "$(HOME)/bin/codex"

slurm_build: server_build

server_run:
	CODEX_SANDBOX="$(SLURM_SANDBOX)" ./codex "$(REPO_DIR)"
