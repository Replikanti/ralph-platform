# Ralph - AI Coding Agent Platform

Ralph is an event-driven AI coding agent that automatically processes Linear issues, generates code using Claude AI, validates it with polyglot toolchains, and pushes pull requests to GitHub.

## Architecture

```mermaid
graph LR
    subgraph "Triggers"
        Linear[Linear Webhook] -->|POST| Ingress
    end
    subgraph "Ralph Platform (GKE)"
        Ingress --> API[Node.js API]
        API -->|Enqueue| Redis[(Redis)]
        Redis -->|Dequeue| Worker[Node.js Worker]

        subgraph "Worker Execution"
            Worker -->|Clone| Git[Ephemeral Workspace]
            Worker -->|Plan| Opus[Claude Opus]
            Worker -->|Code| Sonnet[Claude Sonnet]
            Worker -->|Validate| Polyglot[Toolchain]

            Polyglot -.->|TS| Biome
            Polyglot -.->|TS Types| tsc
            Polyglot -.->|Py| Ruff
            Polyglot -.->|Py Types| mypy
            Polyglot -.->|Sec| Trivy
        end
    end
    Worker -->|Push PR| GitHub
    Worker -->|Trace| LangFuse
```

### How It Works

1. **Trigger**: Create a Linear issue with the label `Ralph`
2. **Webhook**: Linear sends webhook to Ralph API
3. **Queue**: API validates signature, enqueues task to Redis (BullMQ)
4. **Planning**: Worker uses Claude Opus to create implementation plan
5. **Coding**: Worker uses Claude Sonnet to generate code
6. **Validation**: Polyglot toolchain (Biome, Ruff, Mypy, TSC, Trivy) validates the code
7. **Push**: Worker commits and pushes to a feature branch

---

## Security Features

Ralph implements multiple security layers to safely execute AI-generated code in untrusted repositories:

### Agent Tool Execution Security

The agent uses four tools to manipulate code (`list_files`, `read_file`, `write_file`, `run_command`). The `run_command` tool has strict security controls:

**1. Command Allowlist**
Only whitelisted command patterns are permitted:
- Build tools: `npm test`, `npm run build`, `npx`, `node`
- Version control: `git status`, `git log`, `git diff`, `git show`
- File operations: `ls`, `cat`, `pwd`, `echo`
- Testing: `pytest`, `python -m pytest`
- Linters: `ruff`, `mypy`

**2. Dangerous Pattern Blocking**
Commands containing these patterns are automatically rejected:
- Shell metacharacters: `;`, `&`, `|`, `` ` ``, `$()`
- Destructive operations: `rm -rf`
- Device manipulation: `> /dev/`
- Piped downloads: `curl ... |`, `wget ... |`

**3. Resource Limits**
- **Timeout**: 60 seconds maximum
- **Buffer limit**: 1MB output size
- **Output sanitization**: Truncated to 5000 chars (stdout) / 2000 chars (stderr)

**4. Path Traversal Protection**
All file operations validate that resolved paths remain within the ephemeral workspace using `path.resolve()` + `startsWith()` checks.

### Additional Security Layers

- **Webhook Authentication**: HMAC SHA-256 signature verification on Linear webhooks
- **Workspace Isolation**: Each task runs in a UUID-based ephemeral directory (`/tmp/ralph-workspaces`)
- **Security Scanning**: Trivy scans all generated code for vulnerabilities, secrets, and misconfigurations
- **Immutable Guardrails**: Hardcoded security rules prevent secret exposure and sandbox escapes

---

## Quick Start (Local Development)

```bash
# 1. Clone and setup
git clone https://github.com/Replikanti/ralph-platform.git
cd ralph-platform
cp .env.example .env
# Edit .env with your API keys

# 2. Start the stack
docker-compose up --build

# 3. Run tests
npm test
```

For local webhook testing, use [ngrok](https://ngrok.com/): `ngrok http 3000`

---

## Production Deployment (Google Cloud)

### Phase 0: Prerequisites

#### Required Tools

| Tool | Version | Installation |
|------|---------|--------------|
| `gcloud` | latest | [Install Guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | latest | `gcloud components install kubectl` |
| `helm` | 3.x | [Install Guide](https://helm.sh/docs/intro/install/) |
| `terraform` | >= 1.5.0 | [Install Guide](https://developer.hashicorp.com/terraform/install) |
| `docker` | latest | [Install Guide](https://docs.docker.com/get-docker/) |

#### Required API Keys

Before starting, obtain these credentials:

| Service | What You Need | Where to Get It |
|---------|---------------|-----------------|
| **GCP** | Project with billing enabled | [GCP Console](https://console.cloud.google.com/) |
| **Anthropic** | API Key | [Anthropic Console](https://console.anthropic.com/) |
| **GitHub** | Personal Access Token | Settings → Developer settings → PAT (scopes: `repo`, `admin:repo_hook`) |
| **Linear** | Webhook Signing Secret | Settings → API → Webhooks → Create webhook → Copy signing secret |
| **Langfuse** | API Keys (optional) | [Langfuse Cloud](https://cloud.langfuse.com/) or self-hosted |

---

### Phase 1: GCP Project Setup

```bash
# Login to GCP
gcloud auth login
gcloud auth application-default login

# Create new project (or use existing)
export PROJECT_ID="your-project-id"
gcloud projects create $PROJECT_ID --name="Ralph Platform"
gcloud config set project $PROJECT_ID

# Link billing account
gcloud billing accounts list
gcloud billing projects link $PROJECT_ID --billing-account=XXXXXX-XXXXXX-XXXXXX

# Enable required APIs
gcloud services enable \
  container.googleapis.com \
  redis.googleapis.com \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  containerregistry.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com
```

---

### Phase 2: Infrastructure with Terraform

Terraform creates: VPC, GKE cluster, Redis (Memorystore), Workload Identity for GitHub Actions, and auto-configures GitHub secrets.

```bash
cd infra

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
project_id   = "your-project-id"
region       = "europe-west1"
github_owner = "Replikanti"
github_repo  = "ralph-platform"
github_token = "ghp_xxxxxxxxxxxx"  # PAT with repo/admin:repo_hook scopes
EOF

# Create GCS bucket for Terraform state (one-time)
gsutil mb -p $PROJECT_ID -l europe-west1 gs://${PROJECT_ID}-terraform-state

# Initialize Terraform
terraform init \
  -backend-config="bucket=${PROJECT_ID}-terraform-state" \
  -backend-config="prefix=ralph"

# Review plan
terraform plan

# Apply (creates all infrastructure ~15-20 min)
terraform apply
```

#### Terraform Outputs

After apply, note these outputs:
```bash
terraform output
# redis_host              = "10.x.x.x"
# gke_cluster_name        = "ralph-cluster"
# workload_identity_provider = "projects/xxx/locations/global/..."
```

---

### Phase 3: Kubernetes Setup

```bash
# Connect to GKE cluster
gcloud container clusters get-credentials ralph-cluster --region europe-west1

# Verify connection
kubectl get nodes

# Create namespace (optional, default uses 'default')
kubectl create namespace ralph
kubectl config set-context --current --namespace=ralph
```

#### Create Kubernetes Secrets

```bash
# Get Redis IP from Terraform output
REDIS_IP=$(cd infra && terraform output -raw redis_host)

# Create secrets
kubectl create secret generic ralph-redis-secret \
  --from-literal=redis-url="redis://${REDIS_IP}:6379"

kubectl create secret generic ralph-github-token \
  --from-literal=token="ghp_your_github_token"

kubectl create secret generic ralph-anthropic-key \
  --from-literal=key="sk-ant-your_anthropic_key"

kubectl create secret generic ralph-linear-secret \
  --from-literal=webhook-secret="your_linear_signing_secret"

# Langfuse (optional - for tracing)
kubectl create secret generic ralph-langfuse \
  --from-literal=secretKey="sk-lf-xxx" \
  --from-literal=publicKey="pk-lf-xxx" \
  --from-literal=host="https://cloud.langfuse.com"

# Verify secrets
kubectl get secrets
```

---

### Phase 4: Build & Deploy

#### Option A: Manual Deploy (First Time)

```bash
# Build and push Docker image
docker build -t gcr.io/$PROJECT_ID/ralph:latest .
docker push gcr.io/$PROJECT_ID/ralph:latest

# Deploy with Helm
helm upgrade --install ralph ./helm/ralph \
  --set image.repository=gcr.io/$PROJECT_ID/ralph \
  --set image.tag=latest \
  --set redis.existingSecret=ralph-redis-secret \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=ralph.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix

# Verify deployment
kubectl get pods
kubectl get ingress
```

#### Option B: CI/CD (Automated)

After Terraform applies, GitHub secrets are automatically configured. Push to `main` triggers deployment:

```bash
git push origin main
# GitHub Actions builds, pushes, and deploys automatically
```

Check workflow: `.github/workflows/deploy.yaml`

---

### Phase 5: DNS & Ingress

```bash
# Get Ingress external IP (may take few minutes)
kubectl get ingress ralph -w

# Once IP is assigned, configure DNS:
# ralph.example.com → [INGRESS_IP]
```

For GKE managed certificates (HTTPS), add to Helm values:
```yaml
ingress:
  annotations:
    kubernetes.io/ingress.global-static-ip-name: "ralph-static-ip"
    networking.gke.io/managed-certificates: "ralph-certificate"
```

---

### Phase 6: Linear Integration

1. Go to **Linear → Settings → API → Webhooks**
2. Create new webhook:
   - **URL**: `https://ralph.example.com/webhook`
   - **Events**: Enable `Issues` (Create, Update)
3. Copy the **Signing Secret** (should already be in K8s secret from Phase 3)

---

### Phase 7: Verification

```bash
# 1. Health check
curl https://ralph.example.com/health
# Expected: {"status":"ok"}

# 2. Webhook test (should return 401 - no signature)
curl -X POST https://ralph.example.com/webhook
# Expected: "Invalid signature"

# 3. Check logs
kubectl logs -l app=ralph-api --tail=50
kubectl logs -l app=ralph-worker --tail=50

# 4. End-to-end test
# Create Linear issue with label "Ralph" and description of a coding task
# Watch worker logs for processing
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | Redis connection string |
| `GITHUB_TOKEN` | Yes | PAT with `repo` scope |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `LINEAR_WEBHOOK_SECRET` | Yes | Linear webhook signing secret |
| `LANGFUSE_SECRET_KEY` | No | Langfuse secret key |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse public key |
| `LANGFUSE_HOST` | No | Langfuse host URL |
| `DEFAULT_REPO_URL` | No | Default repo for tasks without explicit repo |

### Helm Values

See `helm/ralph/values.yaml` for all configurable options.

Key values:
```yaml
image:
  repository: gcr.io/your-project/ralph
  tag: latest

redis:
  existingSecret: ralph-redis-secret

ingress:
  enabled: true
  hosts:
    - host: ralph.example.com

scaling:
  workerReplicas: 2

resources:
  worker:
    limits:
      memory: 2Gi
```

---

## Troubleshooting

### Pods not starting

```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

### Webhook returns 401

- Verify `LINEAR_WEBHOOK_SECRET` matches Linear webhook settings
- Check API logs: `kubectl logs -l app=ralph-api`

### Worker not processing jobs

- Check Redis connectivity: `kubectl exec -it <api-pod> -- redis-cli -h $REDIS_HOST ping`
- Check worker logs: `kubectl logs -l app=ralph-worker`

### Terraform errors

- Ensure all APIs are enabled
- Check service account permissions
- Verify billing is enabled on project

---

## Development

```bash
# Run tests
npm test

# Run single test file
NODE_OPTIONS=--experimental-vm-modules npx jest tests/server.test.ts

# Build TypeScript
npm run build

# Start locally (requires Redis)
npm run start:api
npm run start:worker
```

---

## License

MIT
