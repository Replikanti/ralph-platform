# gke.tf

# -----------------------------------------------------------------------------
# GKE CLUSTER (Control Plane)
# -----------------------------------------------------------------------------
resource "google_container_cluster" "primary" {
  name = "ralph-cluster"

  # IMPORTANT: Use specific ZONE (e.g. us-central1-a), not region.
  # If you use region, Google charges management fee for HA cluster.
  location = var.zone

  # Remove default pool and create custom one below
  remove_default_node_pool = true
  initial_node_count       = 1

  # Disable deletion protection (for dev/test, allows easy cluster destruction)
  deletion_protection = false

  # Network references (must be defined in vpc.tf)
  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.main.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # PRIVATE CLUSTER CONFIG (Secure configuration)
  private_cluster_config {
    # SECURITY: Enable private nodes (no public IPs on nodes)
    # Nodes will use Cloud NAT for internet access (~$30-50/month cost)
    # This prevents direct internet access to worker nodes
    enable_private_nodes = true

    # SECURITY JUSTIFICATION for public master endpoint:
    # Master endpoint is public (enable_private_endpoint = false) to allow:
    # 1. CI/CD access from GitHub Actions (Workload Identity authenticated)
    # 2. kubectl access from developer workstations
    # 3. Automated deployments without VPN/bastion host requirement
    #
    # Security controls in place:
    # - Authentication required via GCP IAM (service accounts, user accounts)
    # - Kubernetes RBAC enforces authorization
    # - TLS encryption for all API server communication
    # - Optional: master_authorized_networks can restrict source IPs
    # - No anonymous access possible
    #
    # Private endpoint would require:
    # - Bastion host in VPC (~$15-30/month + management overhead)
    # - VPN connection to VPC (complexity + cost)
    # - Cloud Build for CI/CD (additional setup)
    #
    # Trade-off: Public endpoint with strong authentication is acceptable
    # for non-production environments. For production, consider:
    # - Restricting master_authorized_networks to specific IPs
    # - Enabling Binary Authorization
    # - Using Private Google Access
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Allow access to Master (Control Plane) from restricted networks
  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.master_authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr_block
        display_name = cidr_blocks.value.display_name
      }
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}

# -----------------------------------------------------------------------------
# NODE POOL (Worker Nodes)
# -----------------------------------------------------------------------------
resource "google_container_node_pool" "primary_nodes" {
  name     = "ralph-node-pool"
  location = var.zone  # Must be in same zone as cluster
  cluster  = google_container_cluster.primary.name

  # Autoscaling: 1-3 nodes
  # Min 1 ensures cluster is always available (can set to 0 to save costs)
  autoscaling {
    min_node_count = 1
    max_node_count = 3
  }

  node_config {
    # e2-medium (2 vCPU, 4GB RAM) provides enough allocatable memory (>3GB)
    # for Ralph stack (API + 2 Workers + Redis + System pods)
    # e2-small (2GB RAM) is insufficient due to system overhead
    machine_type = "e2-medium"

    # COST OPTIMIZATION: Spot instances (60-91% discount)
    # Can be preempted with 30 seconds notice
    spot = true

    # COST OPTIMIZATION: Standard HDD disk (cheaper than SSD/Balanced)
    disk_type    = "pd-standard"
    disk_size_gb = 30  # 30GB is sufficient for most workloads

    # Service Account and permissions
    service_account = google_service_account.gke_sa.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    # Tags for firewall rules
    tags = ["gke-node", "ralph-cluster"]
  }
}

# -----------------------------------------------------------------------------
# SERVICE ACCOUNT & IAM
# -----------------------------------------------------------------------------
resource "google_service_account" "gke_sa" {
  account_id   = "ralph-gke-node-sa"
  display_name = "GKE Node Service Account"
}

resource "google_project_iam_member" "gke_sa_roles" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/artifactregistry.reader",
    "roles/storage.objectViewer"
  ])
  role    = each.key
  member  = "serviceAccount:${google_service_account.gke_sa.email}"
  project = var.project_id
}
