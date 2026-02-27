/**
 * Shared Linear utilities to avoid code duplication
 */

/**
 * Finds a Linear workflow state by name or synonym
 * @param team Linear team object
 * @param statusName The status name to find (case-insensitive)
 * @returns The matching state or null if not found
 */
export async function findTargetState(team: any, statusName: string) {
    const states = await team.states();
    const name = statusName.toLowerCase();
    
    let state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === name);
    if (state) return state;

    const synonymMap: Record<string, string[]> = {
        'todo': ['triage', 'backlog', 'todo', 'unstarted', 'ready'],
        'in review': ['in review', 'under review', 'peer review', 'review', 'pr'],
        'plan-review': ['plan-review', 'plan review', 'pending review', 'awaiting approval']
    };

    const synonyms = synonymMap[name];
    if (synonyms) {
        for (const syn of synonyms) {
            state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === syn);
            if (state) return state;
        }
    }

    return null;
}
