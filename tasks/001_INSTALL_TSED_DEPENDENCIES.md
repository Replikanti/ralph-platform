# Task 001: Install Ts.ED Dependencies and Configure TypeScript

## Objective
Add all required Ts.ED packages and update TypeScript configuration for decorator support.

## Prerequisites
None (first task).

## Reference Files
- `package.json` (current dependencies)
- `tsconfig.json` (current config)

## Deliverables
- Updated `package.json` with Ts.ED dependencies
- Updated `tsconfig.json` with decorator support

## Instructions

### 1. Install Ts.ED dependencies

```bash
npm install @tsed/common @tsed/core @tsed/di @tsed/exceptions @tsed/platform-express @tsed/swagger @tsed/logger reflect-metadata
```

### 2. Update tsconfig.json

Add these compiler options (preserve all existing options):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/mcp-toonify.ts"]
}
```

**Critical:** `experimentalDecorators` and `emitDecoratorMetadata` are required for Ts.ED DI to work. Without them, decorators like `@Service()`, `@Controller()`, `@Inject()` will silently fail.

**Critical:** Keep `"exclude": ["src/mcp-toonify.ts"]` - this file uses ESM top-level await and cannot be compiled with the main build.

### 3. Verify build still works

```bash
npm run build
```

The existing code should compile without errors. The new dependencies don't affect existing code.

## Acceptance Criteria
- [ ] `npm install` succeeds without errors
- [ ] `tsconfig.json` has `experimentalDecorators: true` and `emitDecoratorMetadata: true`
- [ ] `npm run build` compiles without errors
- [ ] `npm test` still passes (existing tests unaffected)
- [ ] `src/mcp-toonify.ts` remains excluded from tsconfig
