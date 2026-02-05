# Implementation Plan: Go and Terraform Support

## 📋 Executive Summary

Add polyglot validation support for **Go** and **Terraform** to Ralph Platform, enabling code quality enforcement for DevOps infrastructure codebases.

**Timeline Estimate**:
- Go support: ~4 hours
- Terraform support: ~4-6 hours
- Testing & Documentation: ~2 hours

---

## 🔍 Current State Analysis

### Existing Language Support

| Language | Detection | Linter | Formatter | Type Checker | Build/Test |
|----------|-----------|--------|-----------|--------------|------------|
| **TypeScript** | `package.json` + `tsconfig.json` | Biome | Biome | TSC | npm |
| **JavaScript** | `package.json` | Biome | Biome | - | npm |
| **Python** | `pyproject.toml` / `requirements.txt` | Ruff | Ruff | Mypy | pip |

### Validation Architecture

**File**: `src/tools.ts` (lines 199-339)

**Pattern**:
```typescript
async function validateLANGUAGE(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    1. Check if relevant files changed (by extension)
    2. Detect project (config files)
    3. Install dependencies if needed
    4. Run linter with auto-fix
    5. Run type checker
    6. Filter errors to changed files only
    7. Return aggregated result
}
```

**Main entry point**: `runPolyglotValidation()` (line 316)

---

## 🎯 Go Support Requirements

### 1. Tools Selection

| Tool | Purpose | License | Auto-fix | Why |
|------|---------|---------|----------|-----|
| **gofmt** | Formatting | BSD-3 | ✅ Yes | Official Go formatter, standard |
| **goimports** | Import formatting | BSD-3 | ✅ Yes | Adds/removes imports automatically |
| **go vet** | Static analysis | BSD-3 | ❌ No | Official Go checker, catches common mistakes |
| **golangci-lint** | Meta-linter | GPL-3 | ⚠️ Partial | Industry standard, 50+ linters |
| **go build** | Compilation | BSD-3 | ❌ No | Ensures code compiles |
| **go test** | Testing | BSD-3 | ❌ No | Run unit tests |

**Recommended Set**:
- Primary: `goimports` (includes gofmt)
- Static Analysis: `golangci-lint` (comprehensive)
- Compilation: `go build ./...`

**Why not go vet alone?**: golangci-lint includes go vet + 50 more linters (gosimple, staticcheck, etc.)

### 2. Detection Logic

**Trigger files**:
- `go.mod` (primary - Go modules)
- `go.sum` (lockfile)
- `*.go` files in root or subdirectories

**Changed file extensions**: `.go`, `.mod`, `.sum`

### 3. Validation Flow

```typescript
async function validateGo(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    1. Check for *.go file changes or go.mod
    2. Detect: fs.existsSync('go.mod')
    3. Run: go mod download (install dependencies)
    4. Run: goimports -w . (format + imports)
    5. Run: golangci-lint run --fix (lint with auto-fix)
    6. Run: go build ./... (compile check)
    7. Filter errors to changed files
    8. Return result
}
```

### 4. Dockerfile Changes

```dockerfile
# Add after line 6 (before Python install)
# Install Go
RUN curl -fsSL https://go.dev/dl/go1.23.0.linux-amd64.tar.gz | tar -C /usr/local -xzf - && \
    ln -s /usr/local/go/bin/go /usr/local/bin/go && \
    ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt && \
    go install golang.org/x/tools/cmd/goimports@latest && \
    curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b /usr/local/bin v1.55.2 && \
    ln -s /root/go/bin/goimports /usr/local/bin/goimports
```

**Size impact**: ~500 MB (Go toolchain + golangci-lint)

### 5. Command Allowlist Updates

**File**: `src/tools.ts` (line 35-48)

Add to `ALLOWED_COMMAND_PATTERNS`:
```typescript
/^go\s+(build|test|mod|vet|run)/,
/^gofmt\s+/,
/^goimports\s+/,
/^golangci-lint\s+/,
```

---

## 🏗️ Terraform Support Requirements

### 1. Tools Selection

| Tool | Purpose | License | Auto-fix | Why |
|------|---------|---------|----------|-----|
| **terraform fmt** | Formatting | MPL-2.0 | ✅ Yes | Official formatter |
| **terraform validate** | Syntax validation | MPL-2.0 | ❌ No | Official validator |
| **tflint** | Linter | MPL-2.0 | ⚠️ Partial | Best Terraform linter |
| **tfsec** | Security scanner | MIT | ❌ No | Security-focused, replaced by Trivy |
| **checkov** | Policy scanner | Apache-2.0 | ❌ No | More comprehensive than tfsec |

**Recommended Set**:
- Primary: `terraform fmt` + `terraform validate`
- Linting: `tflint` (with AWS/Azure/GCP plugins)
- Security: **Skip** - Trivy already scans `.tf` files!

**Why skip tfsec/checkov?**:
- Trivy (already installed) supports Terraform scanning
- Avoids duplicate security checks
- Reduces Docker image size

### 2. Detection Logic

**Trigger files**:
- `*.tf` files (any Terraform file)
- `.terraform/` directory (Terraform workspace)
- `.terraform.lock.hcl` (lockfile)

**Changed file extensions**: `.tf`, `.tfvars`, `.hcl`

### 3. Validation Flow

```typescript
async function validateTerraform(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    1. Check for *.tf file changes
    2. Detect: find . -name "*.tf" (at least one .tf file)
    3. Run: terraform init -backend=false (initialize without state)
    4. Run: terraform fmt -recursive (format all .tf files)
    5. Run: terraform validate (validate syntax)
    6. Run: tflint --recursive --fix (lint with fixes)
    7. Filter errors to changed files
    8. Return result
}
```

**Critical**: Use `terraform init -backend=false` to avoid needing cloud credentials/state access!

### 4. Dockerfile Changes

```dockerfile
# Add after Go installation
# Install Terraform & TFLint
RUN curl -fsSL https://releases.hashicorp.com/terraform/1.6.6/terraform_1.6.6_linux_amd64.zip -o terraform.zip && \
    unzip terraform.zip -d /usr/local/bin && \
    rm terraform.zip && \
    curl -fsSL https://github.com/terraform-linters/tflint/releases/download/v0.50.0/tflint_linux_amd64.zip -o tflint.zip && \
    unzip tflint.zip -d /usr/local/bin && \
    rm tflint.zip && \
    tflint --init
```

**Size impact**: ~100 MB (Terraform + TFLint)

### 5. Command Allowlist Updates

Add to `ALLOWED_COMMAND_PATTERNS`:
```typescript
/^terraform\s+(init|fmt|validate|plan)/,
/^tflint\s+/,
```

### 6. Special Considerations

**Terraform Init**:
- Must run `terraform init -backend=false` before validate
- Disables backend (no state file access needed)
- Downloads required providers to `.terraform/`
- Safe for validation without credentials

**Provider Credentials**:
- NOT needed for `terraform validate` (syntax check only)
- NOT needed for `tflint` (static analysis)
- Only needed for `terraform plan` (we don't run this)

**State Files**:
- `.terraform/` should be in `.gitignore` (ephemeral)
- `terraform.tfstate` should NEVER be committed
- Ralph won't commit these (ephemeral workspace)

---

## 📝 Implementation Steps

### Phase 1: Go Support (Priority 1)

**Files to modify**:

1. **`src/tools.ts`**
   - Add `validateGo()` function (after `validatePython`, line 285)
   - Add to `runPolyglotValidation()` (call after Python, line 333)
   - Add Go command patterns to allowlist (line 35-48)

2. **`Dockerfile`**
   - Install Go toolchain (after line 6)
   - Install goimports & golangci-lint
   - Test: `docker build -t ralph-test . && docker run --rm ralph-test go version`

3. **`tests/tools.test.ts`**
   - Add test for Go project detection
   - Add test for Go validation success case
   - Add test for Go validation failure case
   - Mock `execAsync` for go commands

4. **Documentation**
   - Update `README.md` - mention Go support in features
   - Update `CLAUDE.md` - add Go to polyglot validation list
   - Update `ARCHITECTURE.md` - add Go tools to validation section

### Phase 2: Terraform Support (Priority 2)

**Files to modify**:

1. **`src/tools.ts`**
   - Add `validateTerraform()` function (after `validateGo`)
   - Add to `runPolyglotValidation()` (call after Go)
   - Add Terraform command patterns to allowlist

2. **`Dockerfile`**
   - Install Terraform CLI (after Go)
   - Install TFLint
   - Test: `docker build -t ralph-test . && docker run --rm ralph-test terraform version`

3. **`tests/tools.test.ts`**
   - Add test for Terraform project detection
   - Add test for Terraform validation with init
   - Add test for Terraform validation failure
   - Mock terraform commands

4. **Documentation**
   - Update all docs to mention Terraform support
   - Add note about `terraform init -backend=false`

### Phase 3: Testing & Validation

**Integration tests**:

1. **Create test repositories** (in `tests/fixtures/`):
   ```
   tests/fixtures/
   ├── go-project/
   │   ├── go.mod
   │   ├── main.go (valid)
   │   └── bad.go (invalid for testing)
   ├── terraform-project/
   │   ├── main.tf (valid)
   │   └── bad.tf (invalid for testing)
   ```

2. **Test scenarios**:
   - Go: Valid code → should pass
   - Go: Formatting issues → should auto-fix
   - Go: Compilation errors → should fail
   - Terraform: Valid config → should pass
   - Terraform: Format issues → should auto-fix
   - Terraform: Syntax errors → should fail

3. **E2E test**:
   - Create test Linear issue
   - Set repo to Go/Terraform test repo
   - Verify Ralph validates correctly
   - Check PR description includes validation status

---

## 🔧 Configuration & Customization

### Per-Repository Configuration

**`.golangci.yml`** (optional in repo):
```yaml
linters:
  enable:
    - gofmt
    - goimports
    - govet
    - staticcheck
    - gosimple
  disable:
    - errcheck  # Can be noisy

run:
  timeout: 5m
  skip-dirs:
    - vendor
```

**`.tflint.hcl`** (optional in repo):
```hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.29.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

Ralph will respect these configs if present in the repository!

---

## ⚠️ Risks & Mitigations

### Risk 1: Docker Image Size

**Current**: ~800 MB
**After Go**: ~1.3 GB (+500 MB)
**After Terraform**: ~1.4 GB (+100 MB)

**Mitigation**:
- Use multi-stage build to reduce final image
- Remove unnecessary files after installation
- Consider separate images for different language stacks

### Risk 2: Validation Time

**Current**: ~10-30s (TS/Python)
**With Go**: +5-10s (first run downloads deps)
**With Terraform**: +3-5s (terraform init)

**Mitigation**:
- Cache Go modules (`GOMODCACHE=/tmp/go-cache`)
- Cache Terraform providers (`.terraform/` in workspace)
- Skip validation if no relevant files changed

### Risk 3: Go/Terraform Not Installed in Dev

**Problem**: Local development without Docker

**Mitigation**:
- Document installation requirements
- Provide docker-compose for local testing
- Validation errors are graceful (don't crash agent)

### Risk 4: Terraform Provider Downloads

**Problem**: Large providers (AWS, Azure, GCP)

**Mitigation**:
- Use `terraform init -backend=false -upgrade=false`
- Providers cached in workspace (ephemeral)
- Cleanup after validation

---

## 📊 Success Metrics

**After implementation, verify**:

1. **Go projects**:
   - ✅ Detects Go projects by `go.mod`
   - ✅ Formats code with `goimports`
   - ✅ Lints with `golangci-lint`
   - ✅ Catches compilation errors
   - ✅ PR description shows "✅ Go" validation

2. **Terraform projects**:
   - ✅ Detects Terraform by `*.tf` files
   - ✅ Formats with `terraform fmt`
   - ✅ Validates syntax with `terraform validate`
   - ✅ Lints with `tflint`
   - ✅ PR description shows "✅ Terraform" validation

3. **Mixed projects**:
   - ✅ Validates both TS + Go in same repo
   - ✅ Validates both Python + Terraform in same repo
   - ✅ Only runs relevant validators for changed files

---

## 🚀 Next Steps

### Immediate Actions

1. **Review this plan** - confirm approach
2. **Prioritize languages** - Go first, then Terraform?
3. **Create branch** - `feat/add-go-terraform-validation`
4. **Implement Phase 1** - Go support
5. **Test thoroughly** - with real Go repos
6. **Implement Phase 2** - Terraform support
7. **Update docs** - all mentions of polyglot support
8. **Create PR** - with comprehensive testing

### Optional Enhancements (Future)

- **Rust support** - rustfmt + clippy
- **Java/Kotlin** - ktlint + spotless
- **Ruby** - rubocop
- **Shell scripts** - shellcheck
- **YAML** - yamllint (for K8s manifests)

---

## 📎 References

**Go Tools**:
- gofmt: https://pkg.go.dev/cmd/gofmt
- goimports: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
- golangci-lint: https://golangci-lint.run/

**Terraform Tools**:
- Terraform CLI: https://www.terraform.io/downloads
- TFLint: https://github.com/terraform-linters/tflint
- Trivy (Terraform scanning): https://aquasecurity.github.io/trivy/

**Current Ralph Architecture**:
- Validation: `src/tools.ts:199-339`
- Dockerfile: `Dockerfile:1-25`
- Tests: `tests/tools.test.ts`

---

**Created**: 2026-02-05
**Author**: Claude (Ralph self-improvement)
**Status**: 📋 **PLANNING** - Awaiting approval to implement
