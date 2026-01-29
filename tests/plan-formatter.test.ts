import { formatPlanForLinear } from '../src/plan-formatter';

describe('Plan Formatter', () => {
    it('should format a simple plan', () => {
        const plan = 'Step 1: Do something\nStep 2: Do something else';
        const result = formatPlanForLinear(plan, 'Test Task');

        expect(result).toContain('# 🤖 Ralph\'s Implementation Plan');
        expect(result).toContain('**Task:** Test Task');
        expect(result).toContain('Step 1: Do something');
        expect(result).toContain('Step 2: Do something else');
        expect(result).toContain('LGTM');
        expect(result).toContain('approved');
    });

    it('should remove XML tags from plan', () => {
        const plan = '<plan>Step 1: Do something</plan>';
        const result = formatPlanForLinear(plan, 'Test Task');

        expect(result).not.toContain('<plan>');
        expect(result).not.toContain('</plan>');
        expect(result).toContain('Step 1: Do something');
    });

    it('should include approval instructions', () => {
        const plan = 'Test plan';
        const result = formatPlanForLinear(plan, 'Test Task');

        expect(result).toContain('Approval Instructions');
        expect(result).toContain('To proceed with this plan');
        expect(result).toContain('To request changes');
    });
});
