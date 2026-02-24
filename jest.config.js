module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/server.test.ts', // Excluded during migration - will be rewritten in task 020
    'tests/agent.test.ts',  // Excluded during migration - will be rewritten in task 021
    'tests/worker.test.ts'  // Excluded during migration - will be rewritten in task 021
  ],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts'],
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
