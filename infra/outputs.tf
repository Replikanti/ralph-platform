output "redis_host" {
  description = "The IP address of the Redis instance"
  value       = google_redis_instance.cache.host
}

output "redis_port" {
  description = "The port of the Redis instance"
  value       = google_redis_instance.cache.port
}

output "redis_url" {
  description = "The connection URL for Redis"
  value       = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
  sensitive   = true
}

output "gke_cluster_name" {
  description = "The name of the GKE cluster"
  value       = google_container_cluster.primary.name
}

output "gke_cluster_endpoint" {
  description = "The endpoint of the GKE cluster"
  value       = google_container_cluster.primary.endpoint
}

output "workload_identity_provider" {
  description = "The Workload Identity Provider resource name"
  value       = google_iam_workload_identity_pool_provider.github_provider.name
}

output "github_service_account" {
  description = "The service account email for GitHub Actions"
  value       = google_service_account.github_actions.email
}

output "github_secrets_guide" {
  description = "Manual GitHub secrets configuration (if not using Terraform)"
  value = <<-EOT
    Set these GitHub Actions secrets manually:

    GCP_PROJECT_ID: ${var.project_id}
    GCP_WORKLOAD_IDENTITY_PROVIDER: ${google_iam_workload_identity_pool_provider.github_provider.name}
    GCP_SERVICE_ACCOUNT: ${google_service_account.github_actions.email}
    GKE_CLUSTER_NAME: ${google_container_cluster.primary.name}
    GKE_ZONE: ${var.zone}
    REDIS_URL: redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}
  EOT
}

# External Secrets Operator outputs
output "external_secrets_service_account" {
  description = "The service account email for External Secrets Operator"
  value       = google_service_account.external_secrets.email
}

output "external_secrets_setup_guide" {
  description = "Guide for setting up External Secrets Operator"
  value = <<-EOT
    External Secrets Operator Setup:

    1. Install ESO via Helm:
       helm repo add external-secrets https://charts.external-secrets.io
       helm repo update
       helm install external-secrets external-secrets/external-secrets \
         --namespace external-secrets \
         --create-namespace \
         --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"=${google_service_account.external_secrets.email}

    2. Secrets are automatically created in GCP Secret Manager
    3. ESO will sync them to Kubernetes as defined in helm/ralph/templates/external-secrets.yaml

    GCP Project: ${var.project_id}
    ESO Service Account: ${google_service_account.external_secrets.email}
  EOT
}
