# GCP Secret Manager secrets for Ralph application
# These are synchronized to Kubernetes using External Secrets Operator

# GitHub Token
resource "google_secret_manager_secret" "github_token" {
  secret_id = "ralph-github-token"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "github_token" {
  secret      = google_secret_manager_secret.github_token.id
  secret_data = var.github_token
}

# Anthropic API Key
resource "google_secret_manager_secret" "anthropic_key" {
  secret_id = "ralph-anthropic-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "anthropic_key" {
  secret      = google_secret_manager_secret.anthropic_key.id
  secret_data = var.anthropic_api_key != "" ? var.anthropic_api_key : "sk-ant-PLACEHOLDER"
}

# Langfuse Public Key
resource "google_secret_manager_secret" "langfuse_public_key" {
  secret_id = "ralph-langfuse-public-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "langfuse_public_key" {
  secret      = google_secret_manager_secret.langfuse_public_key.id
  secret_data = var.langfuse_public_key != "" ? var.langfuse_public_key : "pk-lf-PLACEHOLDER"
}

# Langfuse Secret Key
resource "google_secret_manager_secret" "langfuse_secret_key" {
  secret_id = "ralph-langfuse-secret-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "langfuse_secret_key" {
  secret      = google_secret_manager_secret.langfuse_secret_key.id
  secret_data = var.langfuse_secret_key != "" ? var.langfuse_secret_key : "sk-lf-PLACEHOLDER"
}

# Langfuse Host
resource "google_secret_manager_secret" "langfuse_host" {
  secret_id = "ralph-langfuse-host"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "langfuse_host" {
  secret      = google_secret_manager_secret.langfuse_host.id
  secret_data = var.langfuse_host != "" ? var.langfuse_host : "https://cloud.langfuse.com"
}

# Linear Webhook Secret
resource "google_secret_manager_secret" "linear_secret" {
  secret_id = "ralph-linear-webhook-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "linear_secret" {
  secret      = google_secret_manager_secret.linear_secret.id
  secret_data = var.linear_webhook_secret != "" ? var.linear_webhook_secret : "PLACEHOLDER"
}

# Redis URL (computed from Redis instance)
resource "google_secret_manager_secret" "redis_url" {
  secret_id = "ralph-redis-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.id
  secret_data = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
}
