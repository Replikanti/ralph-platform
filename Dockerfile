FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Python & Deps & Node Tools & Trivy (Security)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl wget && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir --break-system-packages ruff mypy uv && \
    npm install -g @biomejs/biome typescript tsx @ktseng/claude-code-toonify && \
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    curl -fsSL https://claude.ai/install.sh | bash && \
    install -m 755 /root/.local/bin/claude /usr/local/bin/claude

# Build App
COPY package*.json ./
COPY . .
RUN npm ci && npm run build

# Set ownership to existing node user for security (node user is pre-created in node:22-bookworm with UID/GID 1000)
RUN chown -R node:node /app

USER node

CMD ["node", "dist/server.js"]
