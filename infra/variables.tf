variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region (e.g., europe-west1)"
  type        = string
  default     = "europe-west1"
}

variable "zone" {
  description = "GCP Zone for GKE cluster (e.g., europe-west1-a)"
  type        = string
  default     = "europe-west1-a"
}

variable "github_owner" {
  description = "GitHub Organization or User name (e.g., Replikanti)"
  type        = string
}

variable "github_repo" {
  description = "GitHub Repository name (e.g., ralph-platform)"
  type        = string
  default     = "ralph-platform"
}

variable "github_token" {
  description = "GitHub PAT with repo/secrets permissions"
  type        = string
  sensitive   = true
}

# Application Secrets
variable "anthropic_api_key" {
  description = "Anthropic API key for Claude AI (optional, defaults to placeholder)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "langfuse_public_key" {
  description = "Langfuse public key (optional, defaults to placeholder)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "langfuse_secret_key" {
  description = "Langfuse secret key (optional, defaults to placeholder)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "langfuse_host" {
  description = "Langfuse host URL (optional, defaults to https://cloud.langfuse.com)"
  type        = string
  default     = ""
}

variable "linear_webhook_secret" {
  description = "Linear webhook secret (optional, defaults to placeholder)"
  type        = string
  sensitive   = true
  default     = ""
}
