import { LinearClient } from '../src/linear-client';

const mockCreateComment = jest.fn().mockResolvedValue({});
const mockIssue = jest.fn();
const mockUpdateIssue = jest.fn().mockResolvedValue({});
const mockStates = jest.fn().mockResolvedValue({
    nodes: [
        { name: 'In Progress', id: 's1' },
        { name: 'plan-review', id: 's2' }
    ]
});

jest.mock('@linear/sdk', () => {
    return {
        LinearClient: jest.fn().mockImplementation(() => ({
            createComment: mockCreateComment,
            issue: mockIssue.mockResolvedValue({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 's1', name: 'In Progress' })
            }),
            updateIssue: mockUpdateIssue
        }))
    };
});

describe('LinearClient', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        // Reset the mock implementations
        mockIssue.mockResolvedValue({
            team: Promise.resolve({
                states: mockStates
            }),
            state: Promise.resolve({ id: 's1', name: 'In Progress' })
        });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('isEnabled', () => {
        it('should return true when LINEAR_API_KEY is set', () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();
            expect(client.isEnabled()).toBe(true);
        });

        it('should return false when LINEAR_API_KEY is not set', () => {
            delete process.env.LINEAR_API_KEY;
            const client = new LinearClient();
            expect(client.isEnabled()).toBe(false);
        });
    });

    describe('postComment', () => {
        it('should post comment when enabled', async () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();
            
            await expect(client.postComment('issue-123', 'Test comment')).resolves.not.toThrow();
        });

        it('should warn when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            const client = new LinearClient();
            await client.postComment('issue-123', 'Test comment');

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
            consoleSpy.mockRestore();
        });
    });

    describe('updateIssueState', () => {
        it('should update state when enabled', async () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();

            await expect(client.updateIssueState('issue-123', 'In Progress')).resolves.not.toThrow();
        });

        it('should warn when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            const client = new LinearClient();
            await client.updateIssueState('issue-123', 'In Progress');

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
            consoleSpy.mockRestore();
        });
    });

    describe('getIssueState', () => {
        it('should return null when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            const client = new LinearClient();
            const result = await client.getIssueState('issue-123');

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
            consoleSpy.mockRestore();
        });
    });
});
