# Service Account for GitHub Actions
resource "google_service_account" "github_actions" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions Deployer"
}

# IAM Roles for GitHub Actions SA
resource "google_project_iam_member" "github_deployer_roles" {
  for_each = toset([
    "roles/container.developer",  # Access to GKE
    "roles/storage.admin",        # Push to GCR
    "roles/artifactregistry.writer" # Push to Artifact Registry
  ])
  role    = each.key
  member  = "serviceAccount:${google_service_account.github_actions.email}"
  project = var.project_id
}

# Workload Identity Pool
resource "google_iam_workload_identity_pool" "github_pool" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"
  description               = "Identity pool for GitHub Actions"
}

# Workload Identity Provider
resource "google_iam_workload_identity_pool_provider" "github_provider" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_pool.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub Actions Provider"
  
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow GitHub Actions to impersonate the Service Account
resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_pool.name}/attribute.repository/${var.github_owner}/${var.github_repo}"
}

# --- GitHub Secrets Configuration ---

resource "github_actions_secret" "gcp_project_id" {
  repository      = var.github_repo
  secret_name     = "GCP_PROJECT_ID"
  plaintext_value = var.project_id
}

resource "github_actions_secret" "gcp_workload_identity_provider" {
  repository      = var.github_repo
  secret_name     = "GCP_WORKLOAD_IDENTITY_PROVIDER"
  plaintext_value = google_iam_workload_identity_pool_provider.github_provider.name
}

resource "github_actions_secret" "gcp_service_account" {
  repository      = var.github_repo
  secret_name     = "GCP_SERVICE_ACCOUNT"
  plaintext_value = google_service_account.github_actions.email
}

resource "github_actions_secret" "gke_cluster_name" {
  repository      = var.github_repo
  secret_name     = "GKE_CLUSTER_NAME"
  plaintext_value = google_container_cluster.primary.name
}

resource "github_actions_secret" "gke_zone" {
  repository      = var.github_repo
  secret_name     = "GKE_ZONE"
  plaintext_value = var.region # Using region for regional cluster
}
