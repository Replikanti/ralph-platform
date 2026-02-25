/**
 * Test constants
 * Centralized test values to avoid hardcoded strings flagged by security scanners
 */

/** Test credentials - NOT real credentials, only for testing */
export const TEST_CREDENTIALS = {
    ADMIN_USER: 'test-admin',
    ADMIN_PASSWORD: 'test-password-12345',
    WEBHOOK_SECRET: 'test-webhook-secret-abc123',
    API_KEY: 'test-api-key-xyz789',
} as const;

/** Test GitHub data */
export const TEST_GITHUB = {
    REPO_URL: 'https://github.com/test-org/test-repo',
    TOKEN: 'ghp_test1234567890',
    OWNER: 'test-org',
    REPO: 'test-repo',
} as const;

/** Test Linear data */
export const TEST_LINEAR = {
    ISSUE_ID: 'test-issue-123',
    TICKET_ID: 'TEST-123',
    TEAM_KEY: 'TEST',
} as const;

/** Test Redis keys */
export const TEST_REDIS_KEYS = {
    PLAN: 'ralph:plan:test-123',
    TOMBSTONE: 'ralph:tombstone:test-123',
} as const;

/** Test identifiers */
export const TEST_IDS = {
    JOB: 'test-job-id',
    UUID: 'test-uuid-1234',
    TRACE: 'test-trace-id',
} as const;
