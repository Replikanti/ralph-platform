# Ralph Platform - Terraform Infrastructure

## What Gets Created

1. **GKE Cluster** (Secure configuration with private nodes)
   - **Zonal cluster** (not regional) - no management fee
   - 1-3 nodes with autoscaling (min: 1, max: 3)
   - **e2-small instances** (2 vCPU, 2GB RAM) - cheapest functional option
   - **Spot instances** (60-91% discount vs on-demand)
   - **Standard HDD disks** (30GB, cheaper than SSD)
   - **Private nodes** (`enable_private_nodes = true`) - no public IPs on worker nodes
   - **Cloud NAT** for internet access (~$30-50/month for security)
   - Workload Identity enabled for secure access

2. **Google Cloud Memorystore Redis** (Managed Redis)
   - **BASIC tier** (no replication, for dev/test)
   - **1GB memory** (minimum)
   - **Private connection** via VPC peering (not accessible from internet)
   - Redis 7.0

3. **VPC Network**
   - Custom VPC with subnet (`10.0.0.0/20`)
   - Secondary ranges for pods (`10.1.0.0/16`) and services (`10.2.0.0/20`)
   - Cloud Router (for Cloud NAT and VPC peering)
   - Cloud NAT Gateway (for private node internet access)
   - Flow logs (5s interval, 50% sampling)

4. **GitHub Workload Identity** (Keyless authentication)
   - Service Account for GitHub Actions (`github-deployer`)
   - Workload Identity Pool + Provider
   - **Security condition**: Only from `Replikanti/ralph-platform` repository
   - Permissions: GKE access, Artifact Registry write, Storage admin

## Prerequisites

### 1. Install Required Tools

```bash
# Terraform
sudo snap install terraform --classic

# Google Cloud SDK
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init

# kubectl
gcloud components install kubectl
```

### 2. GCP Setup

**a) Create or select a project:**
```bash
# List existing projects
gcloud projects list

# Create new project (optional)
gcloud projects create your-project-id --name="Ralph Platform"

# Set as active
gcloud config set project your-project-id
```

**b) Enable required APIs:**
```bash
gcloud services enable compute.googleapis.com
gcloud services enable container.googleapis.com
gcloud services enable redis.googleapis.com
gcloud services enable servicenetworking.googleapis.com
gcloud services enable iam.googleapis.com
gcloud services enable iamcredentials.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
```

**c) Link billing account:**
```bash
# List billing accounts
gcloud billing accounts list

# Link project to billing account
gcloud billing projects link your-project-id --billing-account=BILLING_ACCOUNT_ID
```

### 3. GitHub Personal Access Token (Optional)

**Note:** GitHub token is only needed if you want Terraform to automatically create GitHub secrets. You can also set secrets manually (see "Configure GitHub Secrets" section below).

If using Terraform for secrets:
- `repo` (full repository access)
- `admin:repo_hook` (manage repository webhooks and hooks)

```bash
# Create at: https://github.com/settings/tokens/new
# Save the token - you won't see it again!
```

**For this installation:** Token is in `terraform.tfvars.example`, but GitHub secrets resources are commented out in the code. You'll set secrets manually after Terraform apply.

## Deployment - Step by Step Guide

### Step 1: Configure Terraform Backend

**IMPORTANT:** The backend bucket is hardcoded in `main.tf`:
```hcl
backend "gcs" {
  bucket = "langfuse-platform-terraform-state"
  prefix = "prod"
}
```

**You have two options:**

**A) Use your own bucket** (recommended for new installation):
```bash
# 1. Create bucket for Terraform state
gsutil mb -p YOUR_PROJECT_ID -l europe-west1 gs://YOUR_PROJECT_ID-tf-state

# 2. Enable versioning (important for safety)
gsutil versioning set on gs://YOUR_PROJECT_ID-tf-state

# 3. Edit main.tf (line 14)
nano main.tf
# Change: bucket = "YOUR_PROJECT_ID-tf-state"
```

**B) Use existing bucket** (if you have access to `langfuse-platform-terraform-state`):
```bash
# Don't change main.tf, bucket already exists
```

### Step 2: Configure Variables

```bash
cd infra

# Copy example and fill in values
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

Fill in `terraform.tfvars`:
```hcl
project_id   = "your-gcp-project-id"         # REQUIRED: Your GCP project
region       = "europe-west1"                 # Can change (us-central1 is cheaper)
zone         = "europe-west1-a"               # Must be in region above
github_owner = "Replikanti"                   # GitHub organization/user
github_repo  = "ralph-platform"               # Repository name
github_token = "ghp_xxxxx"                    # GitHub PAT (optional, secrets set manually)
```

### Step 3: Authenticate to GCP

```bash
# Login to GCP (opens browser)
gcloud auth application-default login

# Set active project
gcloud config set project YOUR_PROJECT_ID

# Verify you're in the correct project
gcloud config get-value project
```

### Step 4: Initialize Terraform

```bash
# Initialize (downloads providers and connects backend)
terraform init

# You should see:
# Initializing the backend...
# Successfully configured the backend "gcs"!
# Terraform has been successfully initialized!
```

**If terraform init fails:**
- Check backend bucket exists: `gsutil ls gs://YOUR_BUCKET_NAME/`
- Check you have permissions: `gcloud projects get-iam-policy YOUR_PROJECT_ID`

### Step 5: Preview Changes

```bash
# Preview what will be created (DRY RUN)
terraform plan

# You should see plan to create ~20 resources:
# - VPC, subnet, router
# - GKE cluster + node pool
# - Redis instance
# - Service accounts
# - IAM bindings
# - Workload Identity pool + provider
```

### Step 6: Apply Infrastructure

```bash
# Apply changes (CREATES INFRASTRUCTURE)
terraform apply

# Terraform will ask:
# Do you want to perform these actions?
# Enter a value: yes
```

**Time estimates:**
- VPC and network: ~1 minute
- GKE cluster: ~10-12 minutes (slowest)
- Redis Memorystore: ~5-8 minutes
- IAM and service accounts: ~1-2 minutes
- **Total: 15-20 minutes**

**Monitor progress during creation:**
```bash
# In another terminal
watch -n 10 'gcloud container clusters list'
watch -n 10 'gcloud redis instances list --region=europe-west1'
```

### Step 7: Verify Deployment

```bash
# Display outputs
terraform output

# You should see:
# - gke_cluster_name
# - gke_cluster_endpoint
# - redis_host, redis_port
# - workload_identity_provider
# - github_service_account
# - github_secrets_guide (with values to set manually)
```

**Connect to GKE cluster:**
```bash
# Get credentials
gcloud container clusters get-credentials ralph-cluster --zone=europe-west1-a

# Verify connection
kubectl get nodes
kubectl get pods --all-namespaces

# You should see 1-3 nodes in Ready state
```

**Test Redis connectivity:**
```bash
# Get Redis IP
REDIS_HOST=$(terraform output -raw redis_host)
REDIS_PORT=$(terraform output -raw redis_port)

# Create test pod
kubectl run redis-test --image=redis:7.0 --rm -it -- redis-cli -h $REDIS_HOST -p $REDIS_PORT ping
# Should return: PONG
```

## Configure GitHub Secrets (Manual)

GitHub secrets resources are commented out in `iam_github.tf`. Set them manually:

```bash
# Get values from Terraform output
terraform output github_secrets_guide
```

Go to GitHub repo: `https://github.com/Replikanti/ralph-platform/settings/secrets/actions`

Add these secrets:

| Secret Name | Value | Source |
|------------|-------|--------|
| `GCP_PROJECT_ID` | Your GCP project ID | `terraform output -raw project_id` (or from tfvars) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name | `terraform output -raw workload_identity_provider` |
| `GCP_SERVICE_ACCOUNT` | Service account email | `terraform output -raw github_service_account` |
| `GKE_CLUSTER_NAME` | Cluster name | `terraform output -raw gke_cluster_name` |
| `GKE_ZONE` | Cluster zone | From your tfvars (e.g., `europe-west1-a`) |
| `REDIS_URL` | Redis connection URL | `terraform output -raw redis_url` |

**Example commands:**
```bash
# Copy these values from terraform output
terraform output -raw workload_identity_provider
terraform output -raw github_service_account
terraform output -raw gke_cluster_name
terraform output redis_url  # Note: marked as sensitive
```

## What's Next?

After successful deployment:

1. **Deploy application** using GitHub Actions or kubectl:
```bash
# Using kubectl (if you have manifests)
kubectl apply -f k8s/

# Or wait for GitHub Actions workflow
# The workflow should now authenticate using Workload Identity
```

2. **Connect to Redis** from pods in GKE:
```bash
# Redis is available on private IP
# Connection string: redis://REDIS_IP:6379
terraform output redis_url
```

3. **Set up monitoring and alerting** (recommended for production):
```bash
# Enable Cloud Monitoring
gcloud services enable monitoring.googleapis.com

# View metrics
gcloud monitoring dashboards list
```

## Maintenance

### Update Infrastructure
```bash
# Change configuration in .tf files
terraform plan
terraform apply
```

### Scaling
```bash
# Edit in gke.tf:
# - autoscaling.min_node_count
# - autoscaling.max_node_count
# - node_config.machine_type

terraform apply
```

### Cost Monitoring
```bash
# Daily costs should be ~$3-4/day:
# - GKE cluster: $0 (free tier for 1 zonal cluster)
# - e2-small node (spot): ~$0.005/hr ($0.12/day)
# - e2-small node (preemptible uptime ~80%): ~$0.40/day
# - Redis 1GB BASIC: ~$0.03/hr ($0.72/day)
# - Cloud NAT Gateway: ~$1.30/day ($40/month)
# - Cloud NAT data processing: ~$0.10-0.50/day (depends on usage)
# - Network: ~$0.10/day
# - Total: ~$3-4/day ($90-120/month)
```

**Monitor actual costs:**
```bash
# View billing
gcloud billing accounts list
gcloud billing projects describe YOUR_PROJECT_ID

# Check in console: https://console.cloud.google.com/billing
```

## Cleanup / Destroy

```bash
# WARNING: Deletes all infrastructure!
terraform destroy

# Terraform will ask for confirmation
# Enter: yes

# Manually delete backend bucket (Terraform doesn't remove it)
gsutil rm -r gs://YOUR_PROJECT_ID-tf-state
```

## Troubleshooting

### Error: "API not enabled"
```bash
# Enable the missing API
gcloud services enable [API_NAME]
```

### Error: "Insufficient permissions"
```bash
# Check permissions
gcloud projects get-iam-policy YOUR_PROJECT_ID

# Add Owner role (for setup)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="user:your-email@example.com" \
  --role="roles/owner"
```

### Error: "Quota exceeded"
```bash
# Check quotas
gcloud compute project-info describe --project=YOUR_PROJECT_ID

# Request increase: https://console.cloud.google.com/iam-admin/quotas
```

### GKE cluster fails to create
```bash
# Check billing account is linked
gcloud billing projects describe YOUR_PROJECT_ID

# Check zone availability
gcloud compute zones list | grep europe-west1

# Check GKE API is enabled
gcloud services list --enabled | grep container
```

### Redis cannot connect to VPC
```bash
# Check Service Networking API
gcloud services list --enabled | grep servicenetworking

# Check VPC peering
gcloud services vpc-peerings list --network=ralph-vpc

# Check private IP allocation
gcloud compute addresses list --global
```

### "Error 403: The caller does not have permission"
```bash
# Ensure you're authenticated
gcloud auth application-default login

# Check active account
gcloud auth list

# Verify project permissions
gcloud projects get-iam-policy YOUR_PROJECT_ID --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:$(gcloud config get-value account)"
```

### Workload Identity authentication fails in GitHub Actions
```bash
# Verify provider exists
gcloud iam workload-identity-pools providers list \
  --location=global \
  --workload-identity-pool=github-pool

# Check service account IAM binding
gcloud iam service-accounts get-iam-policy github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com

# Verify attribute condition
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --format="value(attributeCondition)"
# Should show: assertion.repository == 'Replikanti/ralph-platform'
```

## Security

### Implemented Security Features

✅ **GitHub Workload Identity** (no long-lived secrets, keyless authentication)
✅ **Private Redis** (only accessible from VPC, not from internet)
✅ **Private GKE nodes** (no public IPs, internet via Cloud NAT)
✅ **Cloud NAT** for controlled internet egress from nodes
✅ **GKE Workload Identity** (pods have granular permissions)
✅ **Terraform state in GCS** with versioning
✅ **Repository restriction** on Workload Identity (only `Replikanti/ralph-platform` can authenticate)
✅ **Service account isolation** (separate SAs for GKE nodes and GitHub Actions)

### Security Considerations

⚠️ **Master endpoint is public** (for CI/CD access)
   - Allows kubectl and CI/CD from any IP
   - For higher security: Restrict to specific IPs via authorized networks
   - Command: `gcloud container clusters update --enable-master-authorized-networks`

⚠️ **Spot instances can be preempted** (for cost savings)
   - Can be terminated with 30 seconds notice
   - For production critical workloads: Consider regular nodes or node affinity
   - Current setup: ~60-91% discount vs on-demand pricing

### Hardening for Production

If moving to production, consider:

1. **Restrict master endpoint access** (currently allows 0.0.0.0/0):
```hcl
# In gke.tf:
master_authorized_networks_config {
  cidr_blocks {
    cidr_block   = "YOUR_OFFICE_IP/32"
    display_name = "Office"
  }
  cidr_blocks {
    cidr_block   = "GITHUB_ACTIONS_IP_RANGE"
    display_name = "GitHub Actions"
  }
}
```

2. **Standard tier Redis with replica:**
```hcl
# In redis.tf:
tier           = "STANDARD_HA"
replica_count  = 1
```

3. **Regular nodes instead of Spot:**
```hcl
# In gke.tf:
spot = false
# Remove spot = true
```

## Architecture Details

### Security & Cost Optimizations

This infrastructure balances security and cost:

1. **Zonal cluster (not regional):**
   - Saves ~$0.10/hr ($73/month) management fee
   - Single zone = single point of failure (acceptable for dev/test)

2. **Private nodes with Cloud NAT:**
   - Nodes have no public IPs (secure)
   - Internet access via Cloud NAT Gateway
   - Cost: ~$40/month for NAT Gateway + data processing
   - Security benefit: Prevents direct internet access to worker nodes

3. **Spot instances:**
   - 60-91% discount vs on-demand pricing
   - Can be preempted with 30 seconds notice
   - GKE autoscaler will create new nodes if needed

4. **Standard HDD disks:**
   - ~50% cheaper than SSD or balanced disks
   - Sufficient for most workloads (lower IOPS)

5. **e2-small instances:**
   - 2 vCPU, 2GB RAM - minimum for functional GKE
   - e2-micro (1GB RAM) doesn't work - not enough memory for system pods
   - Cost: ~$0.02/hr on-demand, ~$0.005/hr spot

6. **Redis BASIC tier:**
   - No replication = single instance
   - 1GB minimum size
   - ~$0.03/hr (~$22/month)

### Network Architecture

```
Internet
    |
    v
[GKE Master] (public endpoint: 0.0.0.0/0)
    |
    | Control plane: 172.16.0.0/28
    |
    v
[VPC: ralph-vpc 10.0.0.0/20]
    |
    +-- [Subnet: ralph-subnet]
    |       |-- Primary: 10.0.0.0/20 (nodes)
    |       |-- Secondary: 10.1.0.0/16 (pods)
    |       |-- Secondary: 10.2.0.0/20 (services)
    |
    +-- [Cloud NAT Gateway] (outbound internet access)
    |       |-- NAT IP allocation
    |       |-- Error logging enabled
    |
    +-- [GKE Nodes] (private IPs only, internet via NAT)
    |       |-- e2-small spot instances
    |       |-- 1-3 nodes (autoscaling)
    |       |-- No direct public IP
    |
    +-- [VPC Peering] --> [Google Managed: Redis]
            |-- Private connection
            |-- Internal IP only
            |-- redis-vpc peering
```

### Workload Identity Flow

```
GitHub Actions Workflow
    |
    | (1) OIDC token with repository claim
    v
[GitHub OIDC Provider]
    |
    | (2) Token verification + attribute condition check
    v
[GCP Workload Identity Pool]
    |
    | (3) assertion.repository == 'Replikanti/ralph-platform'
    v
[Workload Identity Provider: github-provider]
    |
    | (4) Map to service account
    v
[Service Account: github-deployer@PROJECT.iam.gserviceaccount.com]
    |
    | (5) Impersonate with roles:
    |     - container.developer
    |     - storage.admin
    |     - artifactregistry.writer
    v
[GKE API / GCR / Artifact Registry]
```

**Security:** Only workflows from `Replikanti/ralph-platform` can impersonate the service account due to `attribute_condition` in `iam_github.tf:38`.

## Next Steps

1. Set up monitoring and alerting (Cloud Monitoring, Prometheus)
2. Configure Redis backups (snapshots)
3. Set up log aggregation (Cloud Logging, Loki)
4. Create staging environment (copy infra with different names)
5. Set up autoscaling based on custom metrics
6. Configure CI/CD pipeline in GitHub Actions
7. Set up SSL/TLS certificates (cert-manager + Let's Encrypt)
8. Configure ingress controller (nginx-ingress, GKE Ingress)

## Cost Optimization Tips

1. **Use preemptible/spot instances for all dev/test workloads** (already configured)
2. **Set aggressive autoscaling** - scale to 0 nodes when not in use (min_node_count = 0)
3. **Use committed use discounts** for production (1 or 3 year commitment = 37-57% discount)
4. **Use sustained use discounts** automatically applied for long-running VMs
5. **Monitor with budgets and alerts** to catch unexpected costs
6. **Delete unused resources** regularly (old disks, IPs, snapshots)
7. **Use e2-micro CloudShell** for maintenance instead of leaving a bastion host running
8. **Optimize Cloud NAT** - monitor data processing charges, consider VPC peering for internal services

## Additional Resources

- [GKE pricing calculator](https://cloud.google.com/products/calculator)
- [Redis pricing](https://cloud.google.com/memorystore/docs/redis/pricing)
- [Workload Identity setup guide](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Spot VMs documentation](https://cloud.google.com/compute/docs/instances/spot)
- [GKE free tier details](https://cloud.google.com/kubernetes-engine/pricing#cluster_management_fee_and_free_tier)
