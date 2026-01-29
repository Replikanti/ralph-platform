# Claude Skills

This directory contains repository-specific instructions and skills for Claude Code.

## How it Works

1. **Discovery**: When Claude Code (or the Ralph agent) runs in this repository, it automatically identifies skills located in `.claude/skills/`.
2. **Standard**: Each skill is a self-contained folder with a `SKILL.md` file containing metadata and instructions.
3. **Usage**: The agent can invoke these skills using the `/skill-name` command during the execution phase.

## Skill Structure

Each skill must be in its own subdirectory under `.claude/skills/` and contain a `SKILL.md` file.

```
.claude/skills/
└── <skill-name>/
    └── SKILL.md
```

The `SKILL.md` must include YAML frontmatter with `name` and `description`.

## Verification

To verify that skills are being detected:

1. Observe the Planning phase in the traces (e.g., in Langfuse). The prompt sent to the Planner should list the available native skills.
2. Review the Agent's plan. It should mention invoking relevant skills (e.g., `/ralph-platform`) when appropriate.
