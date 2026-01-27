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
