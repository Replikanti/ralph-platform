module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
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
