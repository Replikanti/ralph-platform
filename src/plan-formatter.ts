/**
 * Formats an XML plan into readable Markdown for Linear display
 */
export function formatPlanForLinear(plan: string, taskTitle: string): string {
    // Remove XML tags if present
    const cleanPlan = plan
        .replace(/<plan>/g, '')
        .replace(/<\/plan>/g, '')
        .trim();

    // Build formatted output
    const output: string[] = [];
    
    output.push('# 🤖 Ralph\'s Implementation Plan');
    output.push('');
    output.push(`**Task:** ${taskTitle}`);
    output.push('');
    output.push('---');
    output.push('');
    output.push('## Proposed Implementation');
    output.push('');
    output.push(cleanPlan);
    output.push('');
    output.push('---');
    output.push('');
    output.push('## Approval Instructions');
    output.push('');
    output.push('**To proceed with this plan:**');
    output.push('- Reply with `LGTM`, `approved`, `proceed`, or `ship it` to start execution');
    output.push('');
    output.push('**To request changes:**');
    output.push('- Reply with your feedback, and Ralph will revise the plan accordingly');
    output.push('');

    return output.join('\n');
}
