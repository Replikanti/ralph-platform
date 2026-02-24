# The Factory: Execution Strategy (TypeScript Native)

**Objective:** Build a scalable, AI-native coding platform.
**Philosophy:** TypeScript for Agents (Velocity & Type Safety), Go for Control Plane (Scale).

---

## 🚦 Strategic Alignment

### ✅ Decision Gate 1: The Stack -> **TypeScript Native**
*   **Reasoning:** While Python dominates the experimental AI ecosystem, **TypeScript** provides superior production ergonomics for I/O-heavy orchestration (Git, Linters, APIs).
*   **Structured Output:** We will use **BAML's native TS client** to guarantee type-safe LLM outputs without runtime overhead.
*   **Agentic Loops:** We will rely on explicit, "vanilla" TS control flow (or lightweight frameworks like `Ax` for ReAct) instead of black-box Python frameworks. Heavy prompt optimization (DSPy MIPRO) can be run as an *offline* Python process if needed, injecting the resulting optimized prompts back into the TS agents.

### 🛑 Decision Gate 2: The Infrastructure -> **VPS to GKE**
*   **Decision:** Start with **Docker Compose on VPS** for immediate ROI, but design stateless workers ready for a fast-follow migration to **GKE**.

---

## 🗺️ Milestone Roadmap

```mermaid
flowchart TD
    %% Phase 1: Foundation
    subgraph Phase1 [Phase 1: Build & Safety]
        direction TB
        RalphTS[Adapt Ralph Core - TS] --> GitLab[GitLab Adapter]
        GitLab --> BAML[BAML Integration]
        BAML --> Linters[RuboCop/RSpec]
        Linters --> Langfuse[Langfuse Collection]
        Langfuse --> VPS[VPS Deploy]
    end

    %% Trigger 1
    VPS --> Trigger1{Trigger: Stable Loop?}
    Trigger1 -- "Agent solves real tasks" --> Phase2

    %% Phase 2: Intelligence & Quality
    subgraph Phase2 [Phase 2: Data & Intelligence]
        direction TB
        Analysis[Analyze Traces] --> DSPy[TS Agent Loops / Ax]
        DSPy --> Secrets[Secrets Hardening]
    end

    %% Trigger 2 (Branching Path)
    Secrets --> Trigger2{Trigger: Scale Limits?}
    Trigger2 -- "VPS Load / API Latency" --> Phase3
    Trigger2 -- "User Adoption" --> Phase4

    %% Phase 3: Infrastructure Scale
    subgraph Phase3 [Phase 3: Scale & Platform]
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
    
    class RalphTS,BAML,GitLab,Langfuse,GKE,Split critical;
    class VPS,DSPy,Linters,Analysis,Secrets,UI,MultiTenant,SaaS basic;
    class Trigger1,Trigger2 gate;
```

---

## 🛠️ Tactical Steps

### Phase 1: Build & Safety (The Factory v1)
*Goal: A fully observable and safe loop tailored for Avvoka.*
1.  **Adaptation:** Utilize the existing Ralph TS monorepo (PII Redactor already implemented).
2.  **Integration:** Implement GitLab API calls for issue ingestion and MR creation.
3.  **Structure:** Generate **BAML TypeScript client** for strict JSON outputs.
4.  **Validation:** Add `rubocop` and `rspec` execution loops.
5.  **Observability:** **Langfuse Collection** for all AI actions.
6.  **Deploy:** Docker Compose on VPS.

### Phase 2: Data & Intelligence (The Brain)
*Goal: Make the agent smarter without sacrificing transparency.*
1.  **Data Pipeline:** Build an ETL process to analyze Langfuse traces.
2.  **Agentic Logic:** Implement ReAct or Self-Correction loops natively in TS (or via `Ax`), based on trace data.
3.  **Security:** Move secrets to Doppler.

### Phase 3: Scale & Platform (The Beast)
*Trigger: VPS CPU/Memory limits hit due to parallel agent executions.*
1.  **Infrastructure:** Migrate workloads to **GKE**.
2.  **Architecture Split:** Rewrite the Orchestrator (API/Queue) to **Go** for maximum concurrency. Extract TS Agents into ephemeral Kubernetes Jobs.

### Phase 4: Productization (Parallel Track)
*Trigger: Need to empower non-technical users.*
1.  **UI:** Build a Self-Service Portal (Next.js).
2.  **Isolation:** Enforce strict team boundaries.
3.  **Product:** Prepare for "Factory as a Service".