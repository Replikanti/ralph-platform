import { findTargetState } from '../../src/domain/LinearUtils';

describe('LinearUtils', () => {
    describe('findTargetState', () => {
        let mockTeam: any;
        let mockStates: any[];

        beforeEach(() => {
            mockStates = [
                { id: 'state-1', name: 'Todo' },
                { id: 'state-2', name: 'In Progress' },
                { id: 'state-3', name: 'In Review' },
                { id: 'state-4', name: 'Done' },
                { id: 'state-5', name: 'Backlog' },
                { id: 'state-6', name: 'Triage' },
            ];

            mockTeam = {
                states: jest.fn().mockResolvedValue({
                    nodes: mockStates,
                }),
            };
        });

        it('should find state by exact name (case-insensitive)', async () => {
            const result = await findTargetState(mockTeam, 'Todo');
            expect(result).toEqual({ id: 'state-1', name: 'Todo' });
        });

        it('should find state by exact name in different case', async () => {
            const result = await findTargetState(mockTeam, 'IN PROGRESS');
            expect(result).toEqual({ id: 'state-2', name: 'In Progress' });
        });

        it('should find state by synonym - todo', async () => {
            const result = await findTargetState(mockTeam, 'todo');
            expect(result).toEqual({ id: 'state-1', name: 'Todo' });
        });

        it('should find state by synonym - backlog maps to todo', async () => {
            const result = await findTargetState(mockTeam, 'todo');
            // Should find "Todo" first, but if not, should check synonyms
            expect(result).toBeDefined();
            expect(['state-1', 'state-5', 'state-6']).toContain(result.id);
        });

        it('should find state by synonym - triage', async () => {
            mockStates = [
                { id: 'state-1', name: 'Triage' },
                { id: 'state-2', name: 'In Progress' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'todo');
            expect(result).toEqual({ id: 'state-1', name: 'Triage' });
        });

        it('should find state by synonym - in review', async () => {
            const result = await findTargetState(mockTeam, 'in review');
            expect(result).toEqual({ id: 'state-3', name: 'In Review' });
        });

        it('should find state by synonym - review', async () => {
            mockStates = [
                { id: 'state-1', name: 'Review' },
                { id: 'state-2', name: 'Done' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'in review');
            expect(result).toEqual({ id: 'state-1', name: 'Review' });
        });

        it('should find state by synonym - pr', async () => {
            mockStates = [
                { id: 'state-1', name: 'PR' },
                { id: 'state-2', name: 'Done' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'in review');
            expect(result).toEqual({ id: 'state-1', name: 'PR' });
        });

        it('should find state by synonym - under review', async () => {
            mockStates = [
                { id: 'state-1', name: 'Under Review' },
                { id: 'state-2', name: 'Done' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'in review');
            expect(result).toEqual({ id: 'state-1', name: 'Under Review' });
        });

        it('should handle plan-review state', async () => {
            mockStates = [
                { id: 'state-1', name: 'Plan Review' },
                { id: 'state-2', name: 'Done' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'plan-review');
            expect(result).toEqual({ id: 'state-1', name: 'Plan Review' });
        });

        it('should return null if state not found', async () => {
            const result = await findTargetState(mockTeam, 'Unknown State');
            expect(result).toBeNull();
        });

        it('should return null if no synonyms match', async () => {
            mockStates = [
                { id: 'state-1', name: 'Custom State' },
            ];
            mockTeam.states.mockResolvedValue({ nodes: mockStates });

            const result = await findTargetState(mockTeam, 'todo');
            expect(result).toBeNull();
        });

        it('should handle empty state list', async () => {
            mockTeam.states.mockResolvedValue({ nodes: [] });

            const result = await findTargetState(mockTeam, 'todo');
            expect(result).toBeNull();
        });
    });
});
