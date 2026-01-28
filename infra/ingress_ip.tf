# Reserve a static global IP for the Ingress
resource "google_compute_global_address" "ingress_ip" {
  name = "ralph-static-ip"
}

# Output the IP address so we can use it in DNS/Helm
output "ingress_ip_address" {
  value = google_compute_global_address.ingress_ip.address
}
