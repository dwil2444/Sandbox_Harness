AGENT ?= codex
AVAILABLE_AGENTS := $(notdir $(patsubst %/,%,$(dir $(wildcard agents/*/agent.mk))))
ifeq ($(filter $(AGENT),$(AVAILABLE_AGENTS)),)
$(error Unknown AGENT '$(AGENT)'; choose one of: $(AVAILABLE_AGENTS))
endif
include agents/$(AGENT)/agent.mk

IMAGE ?= $(AGENT)
SLURM_SANDBOX ?= $(HOME)/.local/share/$(IMAGE).sif
REPO_DIR ?= $(CURDIR)

.PHONY: build test slurm_build server_build server_run

test:
	node --test tests/*.test.mjs

# Apptainer must already be available on PATH.
build:
	apptainer build --fakeroot --build-arg "$(VERSION_ARG)=$(AGENT_VERSION)" "$(CURDIR)/$(IMAGE).sif" "agents/$(AGENT)/$(AGENT).def"

# Load the HPC module if Apptainer is not already available, then install.
server_build:
	bash -lc 'if ! command -v apptainer >/dev/null 2>&1; then module load apptainer || exit $$?; fi; $(MAKE) build'
	mkdir -p "$(dir $(SLURM_SANDBOX))" "$(HOME)/bin"
	install -m 0644 "$(CURDIR)/$(IMAGE).sif" "$(SLURM_SANDBOX)"
	install -m 0755 "agents/$(AGENT)/launcher" "$(HOME)/bin/$(AGENT)"

slurm_build: server_build

server_run:
	AGENT_SANDBOX="$(SLURM_SANDBOX)" "./agents/$(AGENT)/launcher" "$(REPO_DIR)"
