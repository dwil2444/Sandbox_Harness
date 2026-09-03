IMAGE ?= codex-server
CODEX_VERSION ?= latest
PLATFORM ?= linux/amd64
SLURM_ARCHIVE ?= $(IMAGE).tar
SLURM_SIF ?= $(IMAGE).sif
REPO_DIR ?= $(CURDIR)

.PHONY: build test slurm_build server_build server_run clean

test:
	node --test tests/*.test.mjs

build:
	docker build --platform $(PLATFORM) --build-arg CODEX_VERSION=$(CODEX_VERSION) -t $(IMAGE):latest .
	docker save $(IMAGE):latest -o $(SLURM_ARCHIVE)

# UVA/SLURM build: transfer $(SLURM_ARCHIVE) to the server first, then run:
#   make server_build

server_build:
	bash -lc 'module load apptainer && apptainer build "$(SLURM_SIF)" "docker-archive://$(SLURM_ARCHIVE)"'

slurm_build: server_build

server_run:
	mkdir -p "$$HOME/.codex" && \
	CODEX_RUNTIME="$$(mktemp -d "$${TMPDIR:-/tmp}/codex-home.XXXXXX")" && \
	export CODEX_RUNTIME && \
	REPO_DIR="$(REPO_DIR)" && export REPO_DIR && \
	trap 'rm -rf "$$CODEX_RUNTIME"' EXIT && \
	tar --exclude='*.sqlite*' --exclude='./ipc' -C "$$HOME/.codex" -cf - . | \
		tar -C "$$CODEX_RUNTIME" -xf - && \
	bash -lc 'module load apptainer && apptainer exec --containall --cleanenv \
		--bind "$$CODEX_RUNTIME:/home/codex/.codex" \
		--bind "$$REPO_DIR:/workspace" \
		--pwd /workspace \
		$(SLURM_SIF) codex --sandbox danger-full-access --ask-for-approval never'


clean:
	rm -rf *.tar
	docker rmi $(IMAGE):latest
