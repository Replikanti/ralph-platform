variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region (e.g., europe-west1)"
  type        = string
  default     = "europe-west1"
  validation {
    condition     = can(regex("^europe-", var.region))
    error_message = "Compliance Alert: Data Residency Policy requires resources to be located in Europe."
  }
}

variable "zone" {
  description = "GCP Zone for GKE cluster (e.g., europe-west1-a)"
  type        = string
  default     = "europe-west1-a"
}

variable "resource_labels" {
  description = "Labels to apply to all resources for FinOps and Governance (must include owner)"
  type        = map(string)
  default     = {
    owner       = "platform-team"
    environment = "production"
    cost-center = "shared-infrastructure"
    application = "ralph"
  }
  validation {
    condition     = contains(keys(var.resource_labels), "owner")
    error_message = "Governance Policy: Resources must have an 'owner' tag for accountability."
  }
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

variable "linear_api_key" {
  description = "Linear API key for status updates and comments (optional, defaults to placeholder)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "master_authorized_networks" {
  description = "List of CIDR blocks to allow access to the GKE master endpoint"
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = [
    {
      cidr_block   = "0.0.0.0/0"
      display_name = "Public (All)"
    }
  ]
}
