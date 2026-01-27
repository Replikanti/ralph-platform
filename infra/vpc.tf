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

# Cloud Router (needed for Cloud NAT and VPC peering with Redis)
resource "google_compute_router" "main" {
  name    = "ralph-router"
  region  = var.region
  network = google_compute_network.main.id
}

# Cloud NAT (required for private GKE nodes to access internet)
# Cost: ~$30-50/month for NAT Gateway + data processing
# Security: Prevents direct internet access to worker nodes
resource "google_compute_router_nat" "nat" {
  name   = "ralph-nat"
  router = google_compute_router.main.name
  region = var.region

  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
