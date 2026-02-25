// Mock Ts.ED decorators before imports
import { mockTsEdDecorators } from '../test-utils/common-mocks';

const mocks = mockTsEdDecorators();
jest.mock('@tsed/common', () => mocks['@tsed/common']);
jest.mock('@tsed/logger', () => mocks['@tsed/logger']);

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

// Mock the env module to control LINEAR_API_KEY value
let mockLinearApiKey: string | undefined = undefined;
jest.mock('../../src/config/env', () => ({
    get LINEAR_API_KEY() {
        return mockLinearApiKey;
    },
    PLAN_TTL_DAYS: 7,
}));

import { LinearClientService } from '../../src/services/LinearClientService';

describe('LinearClientService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLinearApiKey = undefined;
        // Reset the mock implementations
        mockIssue.mockResolvedValue({
            team: Promise.resolve({
                states: mockStates
            }),
            state: Promise.resolve({ id: 's1', name: 'In Progress' })
        });
    });

    describe('isEnabled', () => {
        it('should return true when LINEAR_API_KEY is set', () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();
            expect(service.isEnabled()).toBe(true);
        });

        it('should return false when LINEAR_API_KEY is not set', () => {
            mockLinearApiKey = undefined;
            const service = new LinearClientService();
            expect(service.isEnabled()).toBe(false);
        });
    });

    describe('postComment', () => {
        it('should post comment when enabled', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            await expect(service.postComment('issue-123', 'Test comment')).resolves.not.toThrow();
            expect(mockCreateComment).toHaveBeenCalledWith({
                issueId: 'issue-123',
                body: 'Test comment'
            });
        });

        it('should not throw when not enabled', async () => {
            mockLinearApiKey = undefined;
            const service = new LinearClientService();

            await expect(service.postComment('issue-123', 'Test comment')).resolves.not.toThrow();
        });

        it('should throw and log errors', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();
            const error = new Error('API error');
            mockCreateComment.mockRejectedValueOnce(error);

            await expect(service.postComment('issue-123', 'Test')).rejects.toThrow('API error');
        });
    });

    describe('updateIssueState', () => {
        it('should update state when enabled', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            // Mock issue with different current state
            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 'old-state', name: 'Todo' })
            });

            const result = await service.updateIssueState('issue-123', 'In Progress');
            expect(result).toBe(true);
            expect(mockUpdateIssue).toHaveBeenCalledWith('issue-123', { stateId: 's1' });
        });

        it('should return false when not enabled', async () => {
            mockLinearApiKey = undefined;
            const service = new LinearClientService();

            const result = await service.updateIssueState('issue-123', 'In Progress');
            expect(result).toBe(false);
        });

        it('should return false when team not found', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve(null),
                state: Promise.resolve({ id: 's1', name: 'In Progress' })
            });

            const result = await service.updateIssueState('issue-123', 'In Progress');
            expect(result).toBe(false);
        });

        it('should fallback to "In Review" when plan-review not found', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            // Mock states without plan-review, but with In Review
            const statesNodes = {
                nodes: [
                    { name: 'In Review', id: 's3' },
                    { name: 'In Progress', id: 's1' }
                ]
            };

            mockStates.mockResolvedValue(statesNodes);

            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 's1', name: 'In Progress' })
            });

            const result = await service.updateIssueState('issue-123', 'plan-review');
            expect(result).toBe(true);
            expect(mockUpdateIssue).toHaveBeenCalledWith('issue-123', { stateId: 's3' });
        });

        it('should return false when plan-review and fallback not found', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            const statesNodes = {
                nodes: [{ name: 'In Progress', id: 's1' }]
            };

            mockStates.mockResolvedValue(statesNodes);

            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 's1', name: 'In Progress' })
            });

            const result = await service.updateIssueState('issue-123', 'plan-review');
            expect(result).toBe(false);
        });

        it('should return false when state not found', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            const statesNodes = {
                nodes: [{ name: 'In Progress', id: 's1' }]
            };

            mockStates.mockResolvedValue(statesNodes);

            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 's1', name: 'In Progress' })
            });

            const result = await service.updateIssueState('issue-123', 'Unknown State');
            expect(result).toBe(false);
        });

        it('should return true when already in target state', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            const result = await service.updateIssueState('issue-123', 'In Progress');
            expect(result).toBe(true);
            expect(mockUpdateIssue).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();
            mockIssue.mockRejectedValueOnce(new Error('API error'));

            const result = await service.updateIssueState('issue-123', 'In Progress');
            expect(result).toBe(false);
        });
    });

    describe('getIssueState', () => {
        it('should return null when not enabled', async () => {
            mockLinearApiKey = undefined;
            const service = new LinearClientService();

            const result = await service.getIssueState('issue-123');
            expect(result).toBeNull();
        });

        it('should return state name when enabled', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            const result = await service.getIssueState('issue-123');
            expect(result).toBe('In Progress');
        });

        it('should return null when state not found', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            mockIssue.mockResolvedValueOnce({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve(null)
            });

            const result = await service.getIssueState('issue-123');
            expect(result).toBeNull();
        });

        it('should handle errors gracefully', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();
            mockIssue.mockRejectedValueOnce(new Error('API error'));

            const result = await service.getIssueState('issue-123');
            expect(result).toBeNull();
        });
    });

    describe('updateIssueWithComment', () => {
        it('should do nothing when not enabled', async () => {
            mockLinearApiKey = undefined;
            const service = new LinearClientService();

            await expect(
                service.updateIssueWithComment('issue-123', 'In Progress', 'Comment')
            ).resolves.not.toThrow();
        });

        it('should update state and post comment', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            // Mock different state to trigger update
            mockIssue.mockResolvedValue({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 'old', name: 'Todo' })
            });

            await service.updateIssueWithComment('issue-123', 'In Progress', 'Done!');

            expect(mockUpdateIssue).toHaveBeenCalled();
            expect(mockCreateComment).toHaveBeenCalledWith({
                issueId: 'issue-123',
                body: 'Done!'
            });
        });

        it('should update state without comment', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();

            // Mock different state
            mockIssue.mockResolvedValue({
                team: Promise.resolve({
                    states: mockStates
                }),
                state: Promise.resolve({ id: 'old', name: 'Todo' })
            });

            await service.updateIssueWithComment('issue-123', 'In Progress');

            expect(mockUpdateIssue).toHaveBeenCalled();
            expect(mockCreateComment).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            mockLinearApiKey = 'test-key';
            const service = new LinearClientService();
            mockIssue.mockRejectedValue(new Error('API error'));

            await expect(
                service.updateIssueWithComment('issue-123', 'In Progress', 'Comment')
            ).resolves.not.toThrow();
        });
    });
});
