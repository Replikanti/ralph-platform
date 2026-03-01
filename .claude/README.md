# Claude Code Configuration

This directory contains Claude Code commands and settings for working on the Ralph Platform codebase.

## Claude Code Commands (`.claude/commands/`)

Custom slash commands available when working in this repository:

```
.claude/commands/
├── ralph-platform/SKILL.md   — project guidelines and common commands
├── project-map/SKILL.md      — generate TOON-format project structure
├── trace-deps/SKILL.md       — trace dependencies for a file
├── test-filter/SKILL.md      — filter tests by pattern
├── typescript/SKILL.md       — TypeScript best practices
├── python/SKILL.md           — Python best practices
├── golang/SKILL.md           — Go best practices
└── terraform/SKILL.md        — Terraform best practices
```

Use with `/ralph-platform`, `/project-map`, `/trace-deps`, `/test-filter` etc. during Claude Code sessions.

## Agent Skills (`.ralph/skills/` in target repos)

When Ralph executes tasks on a **target repository**, it loads repo-specific instructions from `.ralph/skills/*.md` in that repository — not from this directory.

These per-repo skills provide mutable guidance (coding conventions, preferred libraries, etc.) while security guardrails remain hardcoded in `src/agent/agent.ts`.
