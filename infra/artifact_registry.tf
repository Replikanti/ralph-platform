# Artifact Registry repository for Docker images
# GCR (gcr.io) now uses Artifact Registry as backend

resource "google_artifact_registry_repository" "gcr" {
  location      = "us"  # Multi-region location for GCR compatibility
  repository_id = "gcr.io"
  description   = "Docker repository for GCR (gcr.io) compatibility"
  format        = "DOCKER"
  mode          = "STANDARD_REPOSITORY"

  # Cleanup policy to avoid unbounded storage costs
  # Keep only the last 10 versions, delete older untagged images
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"  # 30 days
    }
  }

  cleanup_policies {
    id     = "keep-last-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  # Allow public read access (optional - for public images)
  # For private images, remove this or set to false
  # cleanup_policy_dry_run = false
}

# Grant GitHub Actions service account access to push images
resource "google_artifact_registry_repository_iam_member" "github_deployer_writer" {
  location   = google_artifact_registry_repository.gcr.location
  repository = google_artifact_registry_repository.gcr.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_actions.email}"
}
