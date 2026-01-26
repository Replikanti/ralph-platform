# Private Service Access for Redis
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "private-ip-alloc"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

# Redis Instance
resource "google_redis_instance" "cache" {
  name           = "ralph-redis"
  memory_size_gb = 1
  region         = var.region

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  redis_version     = "REDIS_6_X"
  display_name      = "Ralph Redis"

  depends_on = [google_service_networking_connection.private_vpc_connection]
}
