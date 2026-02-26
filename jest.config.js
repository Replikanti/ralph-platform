module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/server.test.ts',        // Excluded - replaced by tests/controllers/ + tests/integration/
    'tests/agent.test.ts',         // Excluded - replaced by tests/services/AgentOrchestratorService.test.ts
    'tests/worker.test.ts',        // Excluded - replaced by tests/services/WorkerService.test.ts
    'tests/plan-store.test.ts',    // Excluded - replaced by tests/services/PlanStoreService.test.ts
    'tests/linear-client.test.ts', // Excluded - replaced by tests/services/LinearClientService.test.ts
    'tests/tools.test.ts',         // Excluded - replaced by tests/domain/AgentTools.test.ts
    'tests/workspace.test.ts',     // Excluded - replaced by tests/domain/WorkspaceManager.test.ts
    'tests/plan-formatter.test.ts' // Excluded - replaced by tests/domain/PlanFormatter.test.ts
  ],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/mcp-toonify.ts'  // Excluded - uses top-level await, different module config
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(@redactpii)/)'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
    }]
  },
  moduleNameMapper: {
    '^@redactpii/node$': '<rootDir>/tests/fixtures/redactpii-mock.ts'
  }
};
