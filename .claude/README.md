# Claude Code Skills for Ralph

This directory contains Claude Code skills that provide context and guidelines when working on the Ralph codebase.

## How Skills Work

Skills are loaded by the `listAvailableSkills()` function in `src/agent.ts`. During the planning phase, Claude Opus receives a list of available skills and can reference them in implementation plans.

## Directory Structure

```
.claude/
├── README.md           # This file
└── skills/
    └── ralph-platform/ # Skill directory
        └── SKILL.md    # Skill definition with frontmatter
```

## Adding a New Skill

1. Create a new directory under `.claude/skills/`
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: my-skill-name    # lowercase, hyphens only
   description: Brief description of the skill
   ---
   ```
3. Add instructions, examples, and guidelines
4. The skill will automatically be discovered

## Verifying Skills

### Manual Verification
Run Ralph against this repository and check the logs for:
```
AVAILABLE NATIVE SKILLS (Mention them in your plan if needed):
- /ralph-platform
```

### Automated Verification
```bash
npm test -- tests/skills.test.ts
```

## Skill Loading Flow

1. Worker calls `runAgent()` in `src/agent.ts`
2. `listAvailableSkills()` scans `.claude/skills/` for directories
3. Skill names are passed to Claude Opus in the planning prompt
4. Opus can reference skills in the implementation plan
5. Sonnet receives the plan and follows skill guidelines
