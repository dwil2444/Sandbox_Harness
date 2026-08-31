IMAGE ?= codex-server
CODEX_VERSION ?= latest
PLATFORM ?= linux/amd64
SLURM_ARCHIVE ?= $(IMAGE).tar
SLURM_SIF ?= $(IMAGE).sif

.PHONY: build slurm_build server_build server_run clean

build:
	docker build --platform $(PLATFORM) --build-arg CODEX_VERSION=$(CODEX_VERSION) -t $(IMAGE):latest .
	docker save $(IMAGE):latest -o $(SLURM_ARCHIVE)

# UVA/SLURM build: transfer $(SLURM_ARCHIVE) to the server first, then run:
#   make server_build

server_build:
	bash -lc 'module load apptainer && apptainer build "$(SLURM_SIF)" "docker-archive://$(SLURM_ARCHIVE)"'

slurm_build: server_build

server_run:
	mkdir -p "$$HOME/.codex"
	bash -lc 'module load apptainer && apptainer exec \
		--bind "$$HOME/.codex:/home/codex/.codex" \
		--bind "$$(pwd):/workspace" \
		--pwd /workspace \
		$(SLURM_SIF) codex'


clean:
	rm -rf *.tar
	docker rmi $(IMAGE):latest
