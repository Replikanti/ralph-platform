# Ralph Platform Skills

This directory contains repository-specific instructions and skills for the Ralph AI agent.

## How it Works

1. **Discovery**: When Ralph starts a task, it clones the repository into an ephemeral workspace.
2. **Skill Loading**: The Ralph wrapper (specifically `src/agent.ts`) identifies all skills in `.ralph/skills/`.
3. **Integration**: The wrapper copies these skills to the Claude environment's home directory (`/tmp/.claude/skills/`).
4. **Planning**: During the Planning phase (Claude Opus), the agent is informed of these available "native skills" and is instructed to use them when relevant.
5. **Execution**: During the Execution phase (Claude Sonnet), the agent can invoke these skills using the `/skill-name` command.

## Skill Structure

Each skill must be in its own subdirectory under `.ralph/skills/` and contain a `SKILL.md` file.

```
.ralph/skills/
└── <skill-name>/
    └── SKILL.md
```

The `SKILL.md` must include YAML frontmatter with `name` and `description`.

## Verification

To verify that skills are being detected and used:

1. Check the Ralph Worker logs. You should see entries like `✅ [Agent] Loaded skill: /ralph-platform`.
2. Observe the Planning phase in the traces (e.g., in Langfuse). The prompt sent to the Planner should list the available skills.
3. Review the Agent's plan. It should mention invoking the relevant skill (e.g., `/ralph-platform`).
4. (Optional) Create a test issue that specifically asks Ralph to follow guidelines defined only in the skill, and verify that the resulting PR adheres to them.
