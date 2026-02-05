FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"
ENV GOPATH="/root/go"
WORKDIR /app

# Install Go, Python, Node Tools, Trivy & Claude CLI
RUN curl -fsSL https://go.dev/dl/go1.23.5.linux-amd64.tar.gz | tar -C /usr/local -xzf - && \
    go install golang.org/x/tools/cmd/goimports@latest && \
    curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b /usr/local/bin v1.56.2 && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl wget && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir --break-system-packages ruff mypy uv && \
    npm install -g @biomejs/biome typescript tsx @modelcontextprotocol/sdk && \
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    curl -fsSL https://claude.ai/install.sh | bash && \
    install -m 755 /root/.local/bin/claude /usr/local/bin/claude

# Build App
COPY package*.json ./
COPY . .
RUN npm ci && \
    npm run build && \
    chown -R node:node /app

USER node

CMD ["node", "dist/server.js"]
