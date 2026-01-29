FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Python & Deps & Node Tools & Trivy (Security)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl wget && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir --break-system-packages ruff mypy uv && \
    npm install -g @biomejs/biome typescript tsx && \
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    curl -fsSL https://claude.ai/install.sh | bash && \
    install -m 755 /root/.local/bin/claude /usr/local/bin/claude

# Build App
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Security: Run as non-root user
RUN useradd --create-home --uid 1000 ralph && chown -R ralph:ralph /app
USER ralph

CMD ["node", "dist/server.js"]
