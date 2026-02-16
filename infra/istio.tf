# istio.tf
# Installs Istio Service Mesh via Helm charts

# 1. Istio Base (CRDs)
resource "helm_release" "istio_base" {
  name             = "istio-base"
  repository       = "https://istio-release.storage.googleapis.com/charts"
  chart            = "base"
  namespace        = "istio-system"
  create_namespace = true
  version          = "1.20.3" # Pin version for stability

  # Wait for CRDs to be established
  wait = true
}

# 2. Istiod (Control Plane)
resource "helm_release" "istiod" {
  name             = "istiod"
  repository       = "https://istio-release.storage.googleapis.com/charts"
  chart            = "istiod"
  namespace        = "istio-system"
  create_namespace = true
  version          = "1.20.3"

  # Depends on CRDs from base
  depends_on = [helm_release.istio_base]

  set {
    name  = "meshConfig.accessLogFile"
    value = "/dev/stdout" # Enable access logs
  }
}

# 3. Istio Ingress Gateway
resource "helm_release" "istio_ingress" {
  name             = "istio-ingressgateway"
  repository       = "https://istio-release.storage.googleapis.com/charts"
  chart            = "gateway"
  namespace        = "istio-system"
  create_namespace = true
  version          = "1.20.3"

  depends_on = [helm_release.istiod]

  set {
    name  = "service.type"
    value = "LoadBalancer"
  }
}
