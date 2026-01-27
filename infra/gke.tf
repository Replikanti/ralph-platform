# gke.tf

# -----------------------------------------------------------------------------
# GKE CLUSTER (Control Plane)
# -----------------------------------------------------------------------------
resource "google_container_cluster" "primary" {
  name = "ralph-cluster"

  # DŮLEŽITÉ: Použij konkrétní ZÓNU (např. us-central1-a), ne region.
  # Pokud použiješ region, Google naúčtuje management fee za HA cluster.
  # Předpokládám, že máš proměnnou var.zone, nebo sem napiš "us-central1-a".
  location = var.zone

  # Smažeme defaultní pool a vytvoříme vlastní níže
  remove_default_node_pool = true
  initial_node_count       = 1

  # Vypnutí ochrany proti smazání (pro dev/test, aby šel cluster snadno zničit)
  deletion_protection = false

  # Odkazy na síť (musí být definovány v network.tf nebo main.tf)
  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.main.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # PRIVÁTNÍ CLUSTER CONFIG (Optimalizováno pro cenu)
  private_cluster_config {
    # DŮLEŽITÉ PRO FREE TIER / LOW COST:
    # Musíme povolit veřejné IP pro nody (enable_private_nodes = false).
    # Pokud by byly nody privátní, nemají přístup na internet a musel bys platit Cloud NAT ($30+/měs).
    enable_private_nodes = false

    # Master endpoint zůstává veřejný, aby ses k němu připojil z PC/GitHubu
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Povolení přístupu k Masteru (Control Plane) z internetu
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "Public (All)"
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
  name = "ralph-node-pool"
  # Musí být ve stejné zóně jako cluster!
  location = var.zone
  cluster  = google_container_cluster.primary.name

  # Autoscaling: 0-3 nody. 
  # Min 0 je fajn, že se to může úplně vypnout, ale start trvá déle.
  autoscaling {
    min_node_count = 1
    max_node_count = 3
  }

  node_config {
    # e2-small (2 vCPU, 2GB RAM) je absolutní minimum pro funkční GKE.
    # e2-micro (1GB RAM) NEPOUŽÍVAT - neutáhne systémové pody.
    machine_type = "e2-small"

    # DŮLEŽITÉ PRO CENU: Spot instance (sleva 60-91%)
    spot = true

    # DŮLEŽITÉ PRO CENU: Standardní HDD disk (levnější než SSD/Balanced)
    disk_type    = "pd-standard"
    disk_size_gb = 30 # 30GB bohatě stačí

    # Service Account a oprávnění
    service_account = google_service_account.gke_sa.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    # Tagy pro firewall
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
    # Přidáno pro jistotu, aby nody mohly tahat images z Container Registry/Artifact Registry
    "roles/storage.objectViewer"
  ])
  role    = each.key
  member  = "serviceAccount:${google_service_account.gke_sa.email}"
  project = var.project_id
}
