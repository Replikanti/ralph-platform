terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
  backend "gcs" {
    bucket = "langfuse-platform-terraform-state"
    prefix = "prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  
  # GOVERNANCE: Apply default labels to ALL resources automatically.
  # This solves the "Mystery Resource" problem and enables FinOps Showback.
  default_labels = var.resource_labels
}

provider "github" {
  owner = var.github_owner
  token = var.github_token
}
