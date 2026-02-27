FROM oven/bun:1-debian AS base
ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"
ENV GOPATH="/root/go"
WORKDIR /app

# Install Go, Terraform, Python, Node Tools, Trivy & Claude CLI
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl wget unzip nodejs npm && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | tar -C /usr/local -xzf - && \
    go install golang.org/x/tools/cmd/goimports@latest && \
    go install honnef.co/go/tools/cmd/staticcheck@latest && \
    curl -fsSL https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_amd64.zip -o /tmp/terraform.zip && \
    unzip /tmp/terraform.zip -d /usr/local/bin && \
    rm /tmp/terraform.zip && \
    curl -fsSL https://github.com/terraform-linters/tflint/releases/download/v0.53.0/tflint_linux_amd64.zip -o /tmp/tflint.zip && \
    unzip /tmp/tflint.zip -d /usr/local/bin && \
    rm /tmp/tflint.zip && \
    pip3 install --no-cache-dir --break-system-packages ruff mypy uv && \
    npm install -g @biomejs/biome typescript tsx @modelcontextprotocol/sdk && \
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    curl -fsSL https://claude.ai/install.sh | bash && \
    install -m 755 /root/.local/bin/claude /usr/local/bin/claude

# Build App
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build && \
    chown -R bun:bun /app

USER bun

CMD ["bun", "run", "dist/server.js"]
