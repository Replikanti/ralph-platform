#!/bin/bash
set -e

echo "Installing External Secrets Operator to GKE cluster..."

# Get ESO service account from Terraform output
ESO_SA=$(terraform output -raw external_secrets_service_account)
PROJECT_ID=$(terraform output -raw gke_cluster_name | cut -d'-' -f1)

echo "ESO Service Account: $ESO_SA"

# Add External Secrets Helm repo
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Install External Secrets Operator with Workload Identity annotation
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"=$ESO_SA \
  --set webhook.port=9443 \
  --wait

echo ""
echo "✅ External Secrets Operator installed successfully!"
echo ""
echo "Next steps:"
echo "1. Update secrets in terraform.tfvars with real values (optional)"
echo "2. Run 'terraform apply' to update secrets in GCP Secret Manager"
echo "3. Deploy Ralph application via Helm"
echo ""
echo "Secrets will be automatically synchronized from GCP Secret Manager to Kubernetes."
