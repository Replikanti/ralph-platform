# Ralph Platform - Deployment Guide

This guide covers deploying Ralph to Google Cloud Platform (GKE) with Terraform and Kubernetes.

## Prerequisites

### Required Tools

| Tool | Version | Installation |
|------|---------|--------------|
| `gcloud` | latest | [Install Guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | latest | `gcloud components install kubectl` |
| `helm` | 3.x | [Install Guide](https://helm.sh/docs/intro/install/) |
| `terraform` | >= 1.5.0 | [Install Guide](https://developer.hashicorp.com/terraform/install) |
| `docker` | latest | [Install Guide](https://docs.docker.com/get-docker/) |

### Required API Keys

Before starting, obtain these credentials (add to `terraform.tfvars`):

| Service | What You Need | Where to Get It |
|---------|---------------|-----------------|
| **GCP** | Project with billing | [GCP Console](https://console.cloud.google.com/) |
| **GitHub** | Personal Access Token | Settings → Developer settings → PAT (scopes: `repo`, `admin:repo_hook`) |
| **Anthropic** | API Key | [Anthropic Console](https://console.anthropic.com/) |
| **Linear** | Webhook Secret + API Key | Linear Settings → API → Webhooks |
| **Langfuse** | API Keys (optional) | [Langfuse Cloud](https://cloud.langfuse.com/) |

For complete deployment steps, see the original README sections on:
- Phase 1: GCP Project Setup
- Phase 2: Infrastructure with Terraform
- Phase 3: Secrets Management with External Secrets Operator
- Phase 4: Build & Deploy
- Phase 5: DNS & Ingress
- Phase 6: Linear Integration
- Phase 7: Verification

📖 **Full deployment guide**: See [git history of README.md](https://github.com/Replikanti/ralph-platform/blob/397cc82/README.md#production-deployment) for detailed step-by-step instructions.

## Quick Deploy (Summary)

```bash
# 1. Setup GCP
gcloud auth login
gcloud projects create ralph-platform
gcloud config set project ralph-platform

# 2. Run Terraform
cd infra
terraform init
terraform apply

# 3. Install External Secrets Operator
./install-eso.sh

# 4. Deploy Ralph
helm upgrade --install ralph ./helm/ralph \
  --set image.repository=gcr.io/ralph-platform/ralph \
  --set image.tag=latest

# 5. Configure Linear webhook
# Point to: https://your-domain.com/webhook
```

## Local Development

```bash
# Clone
git clone https://github.com/Replikanti/ralph-platform.git
cd ralph-platform

# Setup environment
cp .env.example .env
# Edit .env with your keys

# Start stack
docker-compose up --build

# In another terminal - expose with ngrok
ngrok http 3000
```

## Configuration

### Environment Variables

See **[README.md](./README.md#-environment-variables)** for complete list.

### Multi-Repository Setup

Ralph supports mapping Linear teams to different GitHub repositories. This is the **recommended approach** for organizations with multiple repositories.

#### Configuration via Helm (Recommended)

Edit `helm/ralph/values.yaml`:

```yaml
# Map Linear team keys to GitHub repository URLs
teamRepos:
  FRONTEND: "https://github.com/myorg/frontend-repo"
  BACKEND: "https://github.com/myorg/backend-repo"
  INFRA: "https://github.com/myorg/infrastructure"
  MOBILE: "https://github.com/myorg/mobile-app"
```

Deploy the changes:

```bash
cd helm/ralph
helm upgrade ralph . -n ralph --values values.yaml
```

#### How It Works

1. **Helm Chart Renders ConfigMap**
   - Template: `templates/configmap.yaml`
   - Source: `values.yaml` → `teamRepos` section
   - Output: Kubernetes ConfigMap mounted at `/etc/ralph/config/repos.json`

2. **Ralph Auto-Reloads Configuration**
   - Checks file modification time (`mtime`)
   - Updates Redis cache when changed
   - **No pod restart required**

3. **Webhook Routing**
   - Issue created in FRONTEND team → clones `frontend-repo`
   - Issue created in BACKEND team → clones `backend-repo`
   - Unknown team → falls back to `DEFAULT_REPO_URL` (if set)

#### Adding a New Repository

```bash
# 1. Edit values.yaml
vim helm/ralph/values.yaml

# Add new line:
# teamRepos:
#   NEWTEAM: "https://github.com/myorg/new-repo"

# 2. Commit to git
git add helm/ralph/values.yaml
git commit -m "feat: add NEWTEAM repository mapping"
git push

# 3. Deploy via Helm
helm upgrade ralph ./helm/ralph -n ralph

# 4. Verify (optional)
helm get values ralph -n ralph | grep -A10 teamRepos
```

#### Legacy: Environment Variable (Not Recommended)

For backwards compatibility only:

```yaml
# In values.yaml under env:
- name: LINEAR_TEAM_REPOS
  value: '{"TEAM":"https://github.com/org/repo"}'
```

⚠️ **Limitations**:
- Requires pod restart on changes
- Harder to manage for multiple repositories
- No version control via values.yaml

**Use `teamRepos` in values.yaml instead.**

See **[ARCHITECTURE.md](./ARCHITECTURE.md#storage--state)** for technical implementation details.

## Monitoring

### BullMQ Dashboard

Access at: `https://your-domain.com/admin/queues`

Credentials: Set `ADMIN_USER` and `ADMIN_PASS` environment variables.

### Langfuse

Configure tracing:
```bash
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_HOST=https://cloud.langfuse.com
```

View traces at: https://cloud.langfuse.com

### Kubernetes

```bash
# Check pods
kubectl get pods

# View logs
kubectl logs -l app=ralph-worker -f
kubectl logs -l app=ralph-api -f

# Check queue
kubectl exec -it redis-pod -- redis-cli
> LLEN ralph-tasks
```

## Troubleshooting

### Pods Not Starting

```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

Common issues:
- Missing secrets (check External Secrets Operator)
- Image pull errors (check GCR permissions)
- Resource limits (check node capacity)

### Webhook Returns 401

- Verify `LINEAR_WEBHOOK_SECRET` matches Linear settings
- Check API logs: `kubectl logs -l app=ralph-api`
- Test signature locally

### Worker Not Processing

- Check Redis: `kubectl exec -it redis-pod -- redis-cli PING`
- Check worker logs: `kubectl logs -l app=ralph-worker`
- Verify worker replicas: `kubectl get deployment ralph-worker`

### Terraform Errors

- Ensure APIs are enabled: `gcloud services list`
- Check billing: `gcloud billing projects describe ralph-platform`
- Verify permissions: `gcloud projects get-iam-policy ralph-platform`

## Production Best Practices

### Security

1. **Network Isolation**: Run workers in private subnet without internet
2. **Credential Rotation**: Rotate tokens monthly
3. **Resource Quotas**: Limit worker CPU/memory
4. **Audit Logging**: Enable GCP audit logs
5. **Secret Management**: Use GCP Secret Manager + External Secrets

### Scaling

```yaml
# helm/ralph/values.yaml
scaling:
  workerReplicas: 3
  workerConcurrency: 2  # Jobs per worker

resources:
  worker:
    requests:
      memory: "1Gi"
      cpu: "500m"
    limits:
      memory: "2Gi"
      cpu: "1000m"
```

### Cost Optimization

1. **Use Spot VMs**: For worker nodes (cheaper)
2. **Enable Autoscaling**: Scale down during off-hours
3. **Cache Projects**: Use persistent volume for Claude cache
4. **Budget Limits**: Set `--max-budget-usd` in agent

### Backup & Recovery

```bash
# Backup Redis
kubectl exec redis-pod -- redis-cli --rdb /data/dump.rdb

# Backup secrets
gcloud secrets list --format=json > secrets-backup.json

# Backup Terraform state
gsutil cp gs://terraform-state-bucket/ralph.tfstate ./backup/
```

---

For architecture details, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.
For usage guide, see **[USER_GUIDE.md](./USER_GUIDE.md)**.
