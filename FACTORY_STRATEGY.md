# The Factory: Execution Strategy

**Objective:** Build a scalable, AI-native coding platform.
**Philosophy:** Python-first for AI, Monolith for velocity, K8s for scale.

## 🗺️ Milestone Roadmap

```mermaid
flowchart TD
    %% Phase 1: Build & Safety
    subgraph Phase1 [Phase 1: Build & Safety]
        direction TB
        PyRewrite[Python Rewrite] --> GitLab[GitLab Adapter]
        GitLab --> BAML[BAML Integration]
        BAML --> PII[Port PII Redactor]
        PII --> Linters[RuboCop/RSpec]
        Linters --> Langfuse[Langfuse Collection]
        Langfuse --> VPS[VPS Deploy]
    end

    %% Trigger 1
    VPS --> Trigger1{Stable Loop?}
    Trigger1 -- Yes --> Phase2

    %% Phase 2: Data & Intelligence
    subgraph Phase2 [Phase 2: Data & Intelligence]
        direction TB
        Pipeline[Data Pipeline ETL] --> Analysis[Error Analysis]
        Analysis --> DSPy[DSPy Optimization]
        DSPy --> Secrets[Secrets Hardening]
    end

    %% Trigger 2 (Branching Path)
    Secrets --> Trigger2{What is the bottleneck?}
    Trigger2 -- "High Load" --> Phase3
    Trigger2 -- "User Adoption" --> Phase4

    %% Phase 3: Scale & Platform
    subgraph Phase3 [Phase 3: Infrastructure Scale]
        direction TB
        GKE[Migrate to GKE] --> EnterpriseSecrets[Enterprise Secrets]
        EnterpriseSecrets --> Split[Split: Go Control Plane]
    end

    %% Phase 4: Productization
    subgraph Phase4 [Phase 4: Productization]
        direction TB
        UI[Self-Service UI] --> MultiTenant[Multi-Tenancy]
        MultiTenant --> SaaS[Factory as a Service]
    end

    classDef basic fill:#e1f5fe,stroke:#01579b,color:#000;
    classDef critical fill:#fff9c4,stroke:#fbc02d,color:#000,stroke-width:2px;
    classDef gate fill:#e8f5e9,stroke:#2e7d32,color:#000,stroke-dasharray: 5 5;
    
    class PyRewrite,BAML,GitLab,Langfuse,GKE,Split critical;
    class VPS,DSPy,Linters,PII,Pipeline,Analysis,Secrets,UI,MultiTenant,SaaS basic;
    class Trigger1,Trigger2 gate;
```

---

## 🛠️ Tactical Steps

### Phase 1: Build & Safety (The Factory v1)
*Goal: Deploy a secure, functional agent tailored for Avvoka's stack.*
1.  **Rewrite:** Python (FastAPI + Arq).
2.  **Safety First:** Port **PII Redactor** immediately. No data leaves without sanitization.
3.  **Integration:** GitLab API Adapter + **BAML** for strict contracts.
4.  **Validation:** `rubocop` and `rspec` runners.
5.  **Observability:** **Langfuse** acts as the "Black Box", recording every trace for Phase 2.
6.  **Deploy:** Simple VPS (Docker Compose).

### Phase 2: Data & Intelligence (The Brain)
*Goal: Use collected data to optimize performance and cost.*
1.  **Data Pipeline:** Build an ETL process to analyze Langfuse traces (Success Rate, Latency).
2.  **Optimization:** Apply **DSPy** to optimize prompts based on real-world failure patterns from Phase 1.
3.  **Hardening:** Move secrets to Doppler, refine PII regexes based on logs.

### Phase 3: Infrastructure Scale (Conditional)
*Trigger: When VPS hits performance limits.*
1.  **Infrastructure:** Migrate to **GKE**.
2.  **Architecture:** Rewrite Control Plane to **Go**.

### Phase 4: Productization (Parallel Track)
*Trigger: When we need to empower non-technical users.*
1.  **UI:** Build a Self-Service Portal (Next.js/Retool).
2.  **Product:** Prepare for "Factory as a Service".

---

## 🧠 Decision Log

| Decision | Choice | Reasoning |
| :--- | :--- | :--- |
| **Language** | **Python** | Native support for BAML, DSPy, LangChain. |
| **Infra (Day 1)** | **VPS** | Fastest time-to-value. Matches current Ops skills. |
| **Infra (Day 100)** | **GKE** | Required for elastic scaling of ephemeral agents. |
| **Safety** | **Deterministic** | Regex/Linter > LLM Judges. |