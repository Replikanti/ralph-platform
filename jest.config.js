module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/server.test.ts',      // Excluded - needs PlatformTest rewrite (task 020)
    'tests/agent.test.ts',       // Excluded - needs service class rewrite (task 021)
    'tests/worker.test.ts',      // Excluded - needs service class rewrite (task 021)
    'tests/plan-store.test.ts',  // Excluded - needs service class rewrite (task 021)
    'tests/linear-client.test.ts' // Excluded - needs service class rewrite (task 021)
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
