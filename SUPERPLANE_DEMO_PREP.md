# SuperPlane Demo & Sync Preparation

**Objective:** Demonstrate "Infra-grade" agent engineering skills using Ralph as proof-of-work.
**Time:** 15 Minutes.
**Audience:** Darko (Founder). Technical, focused on reliability and "Cursor for DevOps".

---

## 1. The Narrative (The "Why")

*   **The Problem:** Most AI agents are "script kiddies" — they work in notebooks but are terrifying in production. They lack state management, rollback capabilities, and strict containment.
*   **The Solution (Ralph):** Ralph is not just a chatbot; it's an **infrastructure control plane** that happens to use LLMs.
*   **My Thesis:** "Containment should be an architectural primitive, not a prompt engineering convention."

---

## 2. The 15-Minute Flow

### 0:00 - 0:02: Intro & Credibility
*   "I built Ralph in < 3 weeks to prove that safe, autonomous coding agents are possible *now* if you treat them like infrastructure services, not magic black boxes."
*   **Key metric:** From `git init` to production K8s deployment with full observability and PII redaction in 17 days.

### 0:02 - 0:08: Architectural Deep Dive (The "Meat")
*Do not show slides. Show code.*

**A. Safety Middleware (The "Cursor for DevOps" angle)**
*   *Open:* `src/security/redactor.ts` & `src/tools.ts`.
*   *Talking Point:* "I don't trust the model to keep secrets. I implemented a deterministic middleware layer that sanitizes all I/O (file reads, command outputs) *before* the LLM ever sees them. This is `O(n)` regex scanning, not `O(cost)` LLM filtering."
*   *Highlight:* The `SecretRedactor` class detecting AWS keys, PEM headers, and generic high-entropy strings.

**B. Containment & Isolation**
*   *Open:* `src/workspace.ts`.
*   *Talking Point:* "Every job gets a UUID-based ephemeral workspace. It's `git clone` -> `execute` -> `validate` -> `commit` -> `destroy`. No shared state pollution."
*   *Open:* `infra/` (Terraform) or `helm/`.
*   *Talking Point:* "This isn't running on my laptop. It's designed for GKE, with proper IAM separation and resource limits defined in Helm."

**C. Deterministic Orchestration**
*   *Open:* `src/worker.ts` & `src/server.ts`.
*   *Talking Point:* "I use BullMQ (Redis) for atomic job locking. If a worker dies, the job is retried with backoff. The state of truth isn't the LLM's memory context—it's the Linear ticket state (Todo -> In Progress -> In Review)."

### 0:08 - 0:12: "Live" Walkthrough (Langfuse & Linear)
*Instead of waiting for a slow build, walk through a finished trace.*

1.  **Show the Linear Ticket:**
    *   "Here is the request. Note the state transitions."
2.  **Show the Langfuse Trace:**
    *   "Here is the execution trace. You can see exactly where the `plan-only` phase ended and the `execute-only` phase began."
    *   "Here is the `PolyglotValidation` span. The agent doesn't just guess; it runs `tsc`, `biome`, `trivy`. If validation fails, it loops."
3.  **Show the PR:**
    *   "The final output is a PR with a summary of changes and validation results."

### 0:12 - 0:15: Discussion & Fit
*   **Question for Darko:** "I see SuperPlane building the control layer. How are you handling the 'human-in-the-loop' aspect for destructive infrastructure actions? Are you intercepting kubectl calls?"
*   **Closing:** "I love building these rigorous systems. Ralph is my playground, but I want to build the 'Cursor for DevOps' at scale with you."

---

## 3. "Gotcha" Prep (Anticipating Questions)

**Q: "How do you handle hallucinations?"**
*   **A:** "I don't prevent them; I catch them. That's why `src/tools.ts` has a strict allowlist. If the model hallucinates a command like `rm -rf /`, the regex blocker catches it before it hits the shell. If it hallucinates code, the `runPolyglotValidation` step (TSC/Biome/Trivy) fails the job before a PR is created."

**Q: "Why separate 'Plan' and 'Execute' phases?"**
*   **A:** "Cost and Control. Planning is cheap ($0.50 budget). Execution is expensive ($2.00). Separating them allows a Human-in-the-Loop review step (via Linear comments) to approve the architecture before burning compute on implementation."

**Q: "How do you handle secrets?"**
*   **A:** "Two layers. 1. Deterministic redaction on Input (so secrets don't go to Anthropic). 2. Trivy scanning on Output (so secrets don't go to GitHub)."

**Q: "What's the hardest part?"**
*   **A:** "Context window management. That's why I built a custom MCP server (`src/mcp-toonify.ts`) to compress JSON outputs into TOON format, saving ~30% tokens on file listings."

---

## 4. Key Files to Have Open
1.  `src/security/redactor.ts` (The new shiny feature)
2.  `src/tools.ts` (The allowlist & validation logic)
3.  `src/worker.ts` (The orchestration engine)
4.  `ARCHITECTURE.md` (The big picture)
