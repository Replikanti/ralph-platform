---
name: typescript
description: Best practices and patterns for TypeScript/JavaScript development
---

# TypeScript/JavaScript Development Guide

## Code Style
- Use strict TypeScript (`"strict": true` in tsconfig.json)
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw Promises
- Export types alongside functions

## Common Patterns
- Use discriminated unions for state management
- Prefer composition over inheritance
- Use `unknown` instead of `any` when type is uncertain

## Testing
- Co-locate tests with source files or use `__tests__` directories
- Use descriptive test names: `it('should return empty array when input is null')`
- Mock external dependencies, not internal modules

## Error Handling
- Create custom error classes extending Error
- Always include error context in messages
- Use Result pattern for expected failures

## Biome/ESLint
- Run `biome check --apply .` before committing
- Address all lint warnings, don't disable rules without justification
