---
name: ralph-platform
description: Project-specific instructions for working on the Ralph Platform codebase.
---

# Ralph Platform Skill

This skill provides guidelines and common commands for developing, testing, and maintaining the Ralph Platform.

## Guidelines

- **Architecture**: Ralph follows an event-driven architecture with an API service (`src/server.ts`) and a Worker service (`src/worker.ts`).
- **Commits**: Use conventional commits (e.g., `feat: ...`, `fix: ...`).
- **PRs**: Ensure that PRs include relevant tests and that all existing tests pass.
- **Safety**: Never expose API keys or secrets in the codebase or logs.
- **Tools**: Use the built-in polyglot validation tools via `npm test` and the custom validation logic in `src/tools.ts`.

## Examples

### Running Tests
To run all tests in the repository:
```bash
npm test
```

### Building the Project
To compile the TypeScript source code:
```bash
npm run build
```

### Adding a New Skill
To add a new skill to the platform, create a new subdirectory in `.ralph/skills/` with a `SKILL.md` file.

## Definition of Done
1. Code is implemented and follows project conventions.
2. Unit tests are added or updated.
3. `npm test` passes successfully.
4. Changes are committed with a meaningful message.
5. A Pull Request is created and linked to the relevant issue.
