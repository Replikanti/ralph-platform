FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Python & Deps
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv git curl && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages ruff mypy semgrep uv

# Install Node Tools
RUN npm install -g @biomejs/biome typescript tsx

# Build App
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

CMD ["node", "dist/server.js"]
