# Claude Commands for Ralph Platform

This directory contains Claude Code commands (skills) that provide context-specific guidance.

## Available Commands

| Command | Description |
|---------|-------------|
| `/project-map` | Lists project structure in token-optimized format |
| `/test-filter` | Runs tests and shows only errors |
| `/trace-deps` | Finds files that depend on a given file |
| `/ralph-platform` | Ralph Platform development guidelines |
| `/typescript` | TypeScript/JavaScript best practices |
| `/python` | Python development best practices |
| `/golang` | Go development best practices |
| `/terraform` | Terraform/IaC best practices |

## Adding Custom Commands

To add a custom command for your repository:

1. Create directory: `.claude/commands/{command-name}/`
2. Add `SKILL.md` with frontmatter:
   ```markdown
   ---
   name: command-name
   description: Brief description
   ---

   # Command Title

   Your guidance content here...
   ```
3. Commit to your repository
4. Ralph will automatically detect and use these commands

## Best Practices for Skills

- Keep skills focused on one topic
- Include concrete examples
- Reference specific tools and their flags
- Update skills based on common errors from Langfuse data
