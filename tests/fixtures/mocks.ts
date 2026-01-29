import { StoredPlan } from '../../src/agent';

/**
 * Creates a mock stored plan for testing
 */
export function createMockStoredPlan(overrides: Partial<StoredPlan> = {}): StoredPlan {
    return {
        taskId: 'issue-123',
        plan: 'Test implementation plan',
        taskContext: {
            ticketId: 'issue-123',
            title: 'Test Task',
            description: 'Test description',
            repoUrl: 'https://github.com/test/repo',
            branchName: 'ralph/feat-TEST-123'
        },
        feedbackHistory: [],
        createdAt: new Date(),
        status: 'pending-review',
        ...overrides
    };
}

/**
 * Creates a mock exec callback for child_process tests
 */
export function createMockExecCallback(
    stdout: string = 'Success',
    stderr: string = '',
    error: Error | null = null
) {
    return (cmd: string, opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (error) {
            const err: any = error;
            err.stdout = stdout;
            callback(err, { stdout });
        } else {
            callback(null, { stdout, stderr });
        }
        return Promise.resolve({ stdout, stderr });
    };
}
