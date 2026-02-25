import { findTargetState } from '../../src/domain/LinearUtils';

describe('LinearUtils', () => {
    describe('findTargetState', () => {
        let mockTeam: any;
        const defaultStates = [
            { id: 'state-1', name: 'Todo' },
            { id: 'state-2', name: 'In Progress' },
            { id: 'state-3', name: 'In Review' },
            { id: 'state-4', name: 'Done' },
            { id: 'state-5', name: 'Backlog' },
            { id: 'state-6', name: 'Triage' },
        ];

        beforeEach(() => {
            mockTeam = {
                states: jest.fn().mockResolvedValue({
                    nodes: defaultStates,
                }),
            };
        });

        describe('exact name matching', () => {
            test.each([
                ['Todo', { id: 'state-1', name: 'Todo' }],
                ['IN PROGRESS', { id: 'state-2', name: 'In Progress' }],
                ['in review', { id: 'state-3', name: 'In Review' }],
            ])('should find state "%s" (case-insensitive)', async (input, expected) => {
                const result = await findTargetState(mockTeam, input);
                expect(result).toEqual(expected);
            });
        });

        describe('synonym matching', () => {
            test.each([
                {
                    desc: 'todo synonyms',
                    searchTerm: 'todo',
                    states: defaultStates,
                    expectedId: 'state-1',
                    expectedName: 'Todo',
                },
                {
                    desc: 'triage as todo synonym',
                    searchTerm: 'todo',
                    states: [
                        { id: 'state-1', name: 'Triage' },
                        { id: 'state-2', name: 'In Progress' },
                    ],
                    expectedId: 'state-1',
                    expectedName: 'Triage',
                },
                {
                    desc: 'review synonym',
                    searchTerm: 'in review',
                    states: [
                        { id: 'state-1', name: 'Review' },
                        { id: 'state-2', name: 'Done' },
                    ],
                    expectedId: 'state-1',
                    expectedName: 'Review',
                },
                {
                    desc: 'PR as review synonym',
                    searchTerm: 'in review',
                    states: [
                        { id: 'state-1', name: 'PR' },
                        { id: 'state-2', name: 'Done' },
                    ],
                    expectedId: 'state-1',
                    expectedName: 'PR',
                },
                {
                    desc: 'under review synonym',
                    searchTerm: 'in review',
                    states: [
                        { id: 'state-1', name: 'Under Review' },
                        { id: 'state-2', name: 'Done' },
                    ],
                    expectedId: 'state-1',
                    expectedName: 'Under Review',
                },
                {
                    desc: 'plan-review special case',
                    searchTerm: 'plan-review',
                    states: [
                        { id: 'state-1', name: 'Plan Review' },
                        { id: 'state-2', name: 'Done' },
                    ],
                    expectedId: 'state-1',
                    expectedName: 'Plan Review',
                },
            ])('should find $desc', async ({ searchTerm, states, expectedId, expectedName }) => {
                mockTeam.states.mockResolvedValue({ nodes: states });
                const result = await findTargetState(mockTeam, searchTerm);
                expect(result).toEqual({ id: expectedId, name: expectedName });
            });
        });

        describe('error handling', () => {
            test.each([
                {
                    desc: 'unknown state',
                    states: defaultStates,
                    searchTerm: 'Unknown State',
                },
                {
                    desc: 'no synonyms match',
                    states: [{ id: 'state-1', name: 'Custom State' }],
                    searchTerm: 'todo',
                },
                {
                    desc: 'empty state list',
                    states: [],
                    searchTerm: 'todo',
                },
            ])('should return null for $desc', async ({ states, searchTerm }) => {
                mockTeam.states.mockResolvedValue({ nodes: states });
                const result = await findTargetState(mockTeam, searchTerm);
                expect(result).toBeNull();
            });
        });

        it('should find state by synonym - backlog maps to todo', async () => {
            const result = await findTargetState(mockTeam, 'todo');
            expect(result).toBeDefined();
            expect(['state-1', 'state-5', 'state-6']).toContain(result.id);
        });
    });
});
