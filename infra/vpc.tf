# VPC
resource "google_compute_network" "main" {
  name                    = "ralph-vpc"
  auto_create_subnetworks = false
}

# Subnet
resource "google_compute_subnetwork" "main" {
  name          = "ralph-subnet"
  ip_cidr_range = "10.0.0.0/20"
  region        = var.region
  network       = google_compute_network.main.id

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.1.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.2.0.0/20"
  }

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Cloud Router (needed for VPC peering with Redis)
resource "google_compute_router" "main" {
  name    = "ralph-router"
  region  = var.region
  network = google_compute_network.main.id
}

# Cloud NAT is NOT needed because GKE nodes have public IPs (enable_private_nodes = false)
# Keeping only the router for VPC peering with managed services like Redis
