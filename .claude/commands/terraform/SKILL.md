---
name: terraform
description: Best practices and patterns for Terraform/Infrastructure as Code
---

# Terraform Development Guide

## Code Style
- Use `terraform fmt` for consistent formatting
- Use snake_case for resource names
- Group related resources in same file

## Module Structure
```
modules/
  module-name/
    main.tf       # Primary resources
    variables.tf  # Input variables
    outputs.tf    # Output values
    README.md     # Module documentation
```

## Best Practices
- Use modules for reusable infrastructure
- Pin provider versions in required_providers
- Use data sources instead of hardcoding IDs
- Store state remotely (S3, GCS, Terraform Cloud)

## Naming Conventions
- Resources: `{provider}_{type}` (e.g., `aws_s3_bucket`)
- Variables: descriptive snake_case (e.g., `bucket_name`)
- Outputs: match the attribute being exposed

## Security
- Never commit secrets to .tf files
- Use variables or secret managers for sensitive values
- Enable encryption for storage resources
- Use least-privilege IAM policies

## Validation
- `terraform validate` checks syntax
- `tflint` checks best practices and cloud-specific rules
- Trivy scans for security misconfigurations
