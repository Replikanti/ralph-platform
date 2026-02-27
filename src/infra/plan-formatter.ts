/**
 * Formats an XML plan into readable Markdown for Linear display
 */
export function formatPlanForLinear(plan: string, taskTitle: string): string {
    // Remove XML tags if present
    const cleanPlan = plan
        .replaceAll('<plan>', '')
        .replaceAll('</plan>', '')
        .trim();

    // Build formatted output
    const output: string[] = [];

    output.push(
        '# 🤖 Ralph\'s Implementation Plan',
        '',
        `**Task:** ${taskTitle}`,
        '',
        '---',
        '',
        '## Proposed Implementation',
        '',
        cleanPlan,
        '',
        '---',
        '',
        '## Approval Instructions',
        '',
        '**To proceed with this plan:**',
        '- Reply with `LGTM`, `approved`, `proceed`, or `ship it` to start execution',
        '',
        '**To request changes:**',
        '- Reply with your feedback, and Ralph will revise the plan accordingly',
        ''
    );

    return output.join('\n');
}
