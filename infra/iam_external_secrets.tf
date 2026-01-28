# Service Account for External Secrets Operator
# This SA is used by ESO to access GCP Secret Manager

resource "google_service_account" "external_secrets" {
  account_id   = "external-secrets-operator"
  display_name = "External Secrets Operator"
  description  = "Service account for External Secrets Operator to access Secret Manager"
}

# Grant Secret Manager access to ESO service account
resource "google_project_iam_member" "external_secrets_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.external_secrets.email}"
}

# Allow ESO Kubernetes service account to impersonate GCP service account
# via Workload Identity
# Note: ServiceAccount is created by Helm chart in the 'default' namespace
resource "google_service_account_iam_member" "external_secrets_workload_identity" {
  service_account_id = google_service_account.external_secrets.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[default/external-secrets]"
}
