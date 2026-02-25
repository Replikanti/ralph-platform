/**
 * Test helper functions to reduce duplication
 */

/**
 * Creates a mock team with states for Linear tests
 */
export function createMockTeam(states: Array<{ id: string; name: string }>) {
    return {
        states: jest.fn().mockResolvedValue({
            nodes: states,
        }),
    };
}

/**
 * Creates a mock Linear issue
 */
export function createMockIssue(overrides: any = {}) {
    return {
        team: Promise.resolve(overrides.team || null),
        state: Promise.resolve(overrides.state || null),
        ...overrides,
    };
}

/**
 * Expects a service method to have been called with specific args
 */
export function expectServiceCall(mockFn: jest.Mock, expectedArgs: any) {
    expect(mockFn).toHaveBeenCalledWith(expectedArgs);
}

/**
 * Expects a service method NOT to have been called
 */
export function expectServiceNotCalled(mockFn: jest.Mock) {
    expect(mockFn).not.toHaveBeenCalled();
}

/**
 * Creates mock validation result for testing
 */
export function createValidationResult(success: boolean, output: string = '') {
    return {
        success,
        output,
        warnings: [],
        errors: success ? [] : [output],
    };
}

/**
 * Creates mock git diff summary
 */
export function createGitDiffSummary(files: string[], insertions = 0, deletions = 0) {
    return {
        files: files.map(f => ({ file: f })),
        insertions: insertions || files.length * 10,
        deletions: deletions || files.length * 5,
        changed: files.length,
    };
}

/**
 * Creates mock git instance for GitHubService tests
 */
export function createMockGit() {
    return {
        diffSummary: jest.fn(),
    };
}
