# Ralph Platform - Terraform Infrastruktura

## Co se vytvoří

1. **GKE Cluster** (Kubernetes cluster v zóně pro nízkou cenu)
   - 1-3 nody s autoscalingem
   - e2-small instance (2 vCPU, 2GB RAM)
   - Spot instance (sleva 60-91%)
   - Veřejné IP pro nody (bez nákladů na Cloud NAT)

2. **Google Cloud Memorystore Redis** (Managed Redis)
   - BASIC tier (bez replikace)
   - 1GB paměť (minimum)
   - Privátní připojení přes VPC peering

3. **VPC síť**
   - Vlastní VPC s podsítí
   - Sekundární rozsahy pro pody a služby

4. **GitHub Workload Identity**
   - Bezpečné nasazení z GitHub Actions bez secrets
   - Automatická konfigurace GitHub secrets

## Požadavky

### 1. Nainstalované nástroje
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

**a) Vytvoř nový projekt nebo vyber existující:**
```bash
# Seznam projektů
gcloud projects list

# Vytvoř nový projekt (volitelné)
gcloud projects create tvuj-projekt-id --name="Ralph Platform"

# Nastav jako aktivní
gcloud config set project tvuj-projekt-id
```

**b) Povol potřebné API:**
```bash
gcloud services enable compute.googleapis.com
gcloud services enable container.googleapis.com
gcloud services enable redis.googleapis.com
gcloud services enable servicenetworking.googleapis.com
gcloud services enable iam.googleapis.com
gcloud services enable iamcredentials.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
```

**c) Vytvoř bucket pro Terraform state:**
```bash
# Vytvoř bucket (použij unikátní název, například tvuj-projekt-id-tf-state)
gsutil mb -p tvoj-projekt-id -l europe-west1 gs://tvoj-projekt-id-tf-state

# Zapni versioning (důležité pro bezpečnost)
gsutil versioning set on gs://tvoj-projekt-id-tf-state
```

**d) Nastav billing účet:**
```bash
# Seznam billing účtů
gcloud billing accounts list

# Propoj projekt s billing účtem
gcloud billing projects link tvuj-projekt-id --billing-account=BILLING_ACCOUNT_ID
```

### 3. GitHub Personal Access Token

Vytvoř GitHub PAT s těmito oprávněními:
- `repo` (full repository access)
- `admin:repo_hook` (manage repository webhooks and hooks)

```bash
# Vytvoř na: https://github.com/settings/tokens/new
# Ulož token - už ho neuvidíš!
```

## Nasazení

### 1. Konfigurace

```bash
cd infra

# Zkopíruj příklad a vyplň hodnoty
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

Vyplň v `terraform.tfvars`:
```hcl
project_id   = "tvuj-gcp-project-id"
region       = "europe-west1"
zone         = "europe-west1-a"
github_owner = "Replikanti"
github_repo  = "ralph-platform"
github_token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 2. Konfigurace Terraform Backend

Uprav `main.tf` a vyplň bucket name:
```hcl
backend "gcs" {
  bucket = "tvoj-projekt-id-tf-state"
  prefix = "prod"
}
```

### 3. Autentizace

```bash
# Přihlaš se do GCP
gcloud auth application-default login

# Ověř, že jsi ve správném projektu
gcloud config get-value project
```

### 4. Spuštění Terraform

```bash
# Inicializace (stáhne providery a nastaví backend)
terraform init

# Náhled změn
terraform plan

# Aplikuj infrastrukturu (cca 10-15 minut)
terraform apply
```

**Poznámky:**
- První spuštění trvá 10-15 minut (GKE cluster se vytváří pomalu)
- Terraform se zeptá na potvrzení - napiš `yes`
- Redis Memorystore může trvat 5-10 minut

### 5. Ověření

```bash
# Zobraz výstupy
terraform output

# Připoj se ke clusteru
gcloud container clusters get-credentials ralph-cluster --zone=europe-west1-a

# Ověř připojení
kubectl get nodes
kubectl get pods --all-namespaces
```

## Co dál?

Po úspěšném nasazení:

1. **GitHub Secrets** jsou automaticky nakonfigurovány:
   - `GCP_PROJECT_ID`
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_SERVICE_ACCOUNT`
   - `GKE_CLUSTER_NAME`
   - `GKE_ZONE`
   - `REDIS_URL`

2. **Nasaď aplikaci** pomocí GitHub Actions nebo kubectl:
```bash
# Pomocí kubectl (pokud máš manifesty)
kubectl apply -f k8s/

# Nebo počkej na GitHub Actions workflow
```

3. **Připoj se k Redis** z podů v GKE:
```bash
# Redis je dostupný na privátní IP
# Connection string: redis://REDIS_IP:6379
terraform output redis_url
```

## Údržba

### Aktualizace infrastruktury
```bash
# Změň konfiguraci v .tf souborech
terraform plan
terraform apply
```

### Škálování
```bash
# Uprav v gke.tf:
# - autoscaling.min_node_count
# - autoscaling.max_node_count
# - node_config.machine_type

terraform apply
```

### Monitorování nákladů
```bash
# Denní náklady by měly být < $2-3/den:
# - GKE cluster: $0 (free tier do 1 zónového clusteru)
# - e2-small node: ~$0.02/hod ($0.48/den)
# - Redis 1GB BASIC: ~$0.03/hod ($0.72/den)
# - Síť: ~$0.10/den
```

## Odstranění

```bash
# POZOR: Smaže všechnu infrastrukturu!
terraform destroy

# Manuálně smaž bucket (Terraform ho nezruší)
gsutil rm -r gs://tvoj-projekt-id-tf-state
```

## Řešení problémů

### Chyba: "API not enabled"
```bash
# Povol chybějící API
gcloud services enable [API_NAME]
```

### Chyba: "Insufficient permissions"
```bash
# Zkontroluj oprávnění
gcloud projects get-iam-policy tvuj-projekt-id

# Přidej roli Owner (pro setup)
gcloud projects add-iam-policy-binding tvuj-projekt-id \
  --member="user:tvuj-email@example.com" \
  --role="roles/owner"
```

### Chyba: "Quota exceeded"
```bash
# Zkontroluj kvóty
gcloud compute project-info describe --project=tvuj-projekt-id

# Požádej o navýšení na: https://console.cloud.google.com/iam-admin/quotas
```

### GKE cluster se nevytvoří
```bash
# Zkontroluj, že máš billing účet
gcloud billing projects describe tvuj-projekt-id

# Zkontroluj dostupnost zóny
gcloud compute zones list | grep europe-west1
```

### Redis se nemůže připojit k VPC
```bash
# Zkontroluj Service Networking API
gcloud services list --enabled | grep servicenetworking

# Zkontroluj VPC peering
gcloud services vpc-peerings list --network=ralph-vpc
```

## Bezpečnost

- ✅ GitHub Workload Identity (bez dlouhodobých secrets)
- ✅ Privátní Redis (pouze z VPC)
- ✅ GKE Workload Identity (pody mají granulární oprávnění)
- ✅ Terraform state v GCS s versioningem
- ⚠️  Master endpoint je veřejný (pro CI/CD) - pro produkci zvážit autorizované sítě
- ⚠️  Nody mají veřejné IP (pro úsporu na NAT) - pro produkci zvážit privátní nody

## Další kroky

1. Nastav monitoring a alerting (Cloud Monitoring)
2. Konfiguraj backup (Redis snapshots)
3. Nastav log aggregaci (Cloud Logging)
4. Vytvoř staging prostředí (zkopíruj infra s jinými názvy)
5. Nastav autoscaling na základě metrik
