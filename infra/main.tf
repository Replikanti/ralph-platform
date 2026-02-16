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
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
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

# Access token for Helm provider
data "google_client_config" "default" {}

# Helm Provider Configuration
provider "helm" {
  kubernetes {
    host                   = "https://${google_container_cluster.primary.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(google_container_cluster.primary.master_auth[0].cluster_ca_certificate)
  }
}
