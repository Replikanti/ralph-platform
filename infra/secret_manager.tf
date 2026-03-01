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

# Linear API Key
resource "google_secret_manager_secret" "linear_api_key" {
  secret_id = "ralph-linear-api-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "linear_api_key" {
  secret      = google_secret_manager_secret.linear_api_key.id
  secret_data = var.linear_api_key != "" ? var.linear_api_key : "lin_api_PLACEHOLDER"
}

# Admin Password (for Bull Board)
resource "google_secret_manager_secret" "admin_pass" {
  secret_id = "ralph-admin-pass"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "admin_pass" {
  secret      = google_secret_manager_secret.admin_pass.id
  secret_data = var.admin_pass
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

# Claude Max Account Pool — credential slots
# 4 slots pre-created; values are pushed by CI/CD from GitHub Actions secrets.
# To use slot N: add CLAUDE_CREDENTIALS_N secret in GitHub UI, then add account-N
# to claudeAccounts.accounts and claudeAccounts.externalSecrets in values.yaml.
resource "google_secret_manager_secret" "claude_credentials" {
  count     = 4
  secret_id = "ralph-claude-credentials-${count.index}"

  replication {
    auto {}
  }
}
