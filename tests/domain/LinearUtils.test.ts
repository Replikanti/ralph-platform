import { findTargetState } from '../../src/domain/LinearUtils';
import { createMockTeam } from '../test-utils/test-helpers';

describe('LinearUtils - findTargetState', () => {
    const defaultStates = [
        { id: 'state-1', name: 'Todo' },
        { id: 'state-2', name: 'In Progress' },
        { id: 'state-3', name: 'In Review' },
        { id: 'state-4', name: 'Done' },
        { id: 'state-5', name: 'Backlog' },
        { id: 'state-6', name: 'Triage' },
    ];

    describe('exact name matching', () => {
        test.each([
            ['Todo', 'state-1', 'Todo'],
            ['IN PROGRESS', 'state-2', 'In Progress'],
            ['in review', 'state-3', 'In Review'],
        ])('%s -> %s', async (input, expectedId, expectedName) => {
            const team = createMockTeam(defaultStates);
            const result = await findTargetState(team, input);
            expect(result).toEqual({ id: expectedId, name: expectedName });
        });
    });

    describe('synonym matching', () => {
        test.each([
            ['todo', defaultStates, 'state-1', 'Todo'],
            ['todo', [{ id: 's1', name: 'Triage' }, { id: 's2', name: 'Done' }], 's1', 'Triage'],
            ['in review', [{ id: 's1', name: 'Review' }, { id: 's2', name: 'Done' }], 's1', 'Review'],
            ['in review', [{ id: 's1', name: 'PR' }, { id: 's2', name: 'Done' }], 's1', 'PR'],
            ['in review', [{ id: 's1', name: 'Under Review' }], 's1', 'Under Review'],
            ['plan-review', [{ id: 's1', name: 'Plan Review' }], 's1', 'Plan Review'],
        ])('%s with states -> %s (%s)', async (term, states, id, name) => {
            const team = createMockTeam(states);
            const result = await findTargetState(team, term);
            expect(result).toEqual({ id, name });
        });
    });

    describe('error handling', () => {
        test.each([
            ['Unknown State', defaultStates],
            ['todo', [{ id: 's1', name: 'Custom' }]],
            ['todo', []],
        ])('returns null for: %s', async (term, states) => {
            const team = createMockTeam(states);
            const result = await findTargetState(team, term);
            expect(result).toBeNull();
        });
    });

    it('finds any todo synonym', async () => {
        const team = createMockTeam(defaultStates);
        const result = await findTargetState(team, 'todo');
        expect(result).toBeDefined();
        expect(['state-1', 'state-5', 'state-6']).toContain(result.id);
    });
});
