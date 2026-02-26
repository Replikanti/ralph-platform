import { describe, it, expect } from '@jest/globals';
import { isApprovalComment, routeComment, shouldSkipIssueWebhook, hasRalphLabel, isRalphOwnComment, isInReviewState, isAlreadyProcessing } from '../../src/domain/webhook-routing';
import { WebhookComment, WebhookIssue, StoredPlanContext } from '../../src/domain/types';

describe('webhook-routing', () => {
  describe('isApprovalComment', () => {
    it('recognizes lgtm', () => expect(isApprovalComment('LGTM')).toBe(true));
    it('recognizes approved', () => expect(isApprovalComment('Approved')).toBe(true));
    it('recognizes proceed', () => expect(isApprovalComment('proceed')).toBe(true));
    it('recognizes ship it', () => expect(isApprovalComment('ship it')).toBe(true));
    it('rejects regular feedback', () => expect(isApprovalComment('please fix the tests')).toBe(false));
  });

  describe('shouldSkipIssueWebhook', () => {
    it('skips update in terminal states', () => {
      expect(shouldSkipIssueWebhook('update', 'In Progress')).toBe(true);
      expect(shouldSkipIssueWebhook('update', 'In Review')).toBe(true);
      expect(shouldSkipIssueWebhook('update', 'Completed')).toBe(true);
      expect(shouldSkipIssueWebhook('update', 'Canceled')).toBe(true);
      expect(shouldSkipIssueWebhook('update', 'Done')).toBe(true);
    });

    it('does not skip non-update actions', () => {
      expect(shouldSkipIssueWebhook('create', 'Todo')).toBe(false);
    });

    it('does not skip update in non-terminal states', () => {
      expect(shouldSkipIssueWebhook('update', 'Todo')).toBe(false);
      expect(shouldSkipIssueWebhook('update', 'Backlog')).toBe(false);
    });
  });

  describe('hasRalphLabel', () => {
    it('returns true if Ralph label is present', () => {
      const issue: Partial<WebhookIssue> = {
        labels: [{ name: 'Feature' }, { name: 'Ralph' }]
      };
      expect(hasRalphLabel(issue as WebhookIssue)).toBe(true);
    });

    it('returns false if Ralph label is missing', () => {
      const issue: Partial<WebhookIssue> = {
        labels: [{ name: 'Feature' }]
      };
      expect(hasRalphLabel(issue as WebhookIssue)).toBe(false);
    });
  });

  describe('isRalphOwnComment', () => {
    it('recognizes ralph in author name', () => {
      const comment: Partial<WebhookComment> = {
        author: { name: 'Ralph Bot' },
        body: 'Hello'
      };
      expect(isRalphOwnComment(comment as WebhookComment)).toBe(true);
    });

    it('recognizes ralph bot icon in body', () => {
      const comment: Partial<WebhookComment> = {
        author: { name: 'User' },
        body: '🤖 Ralph is working'
      };
      expect(isRalphOwnComment(comment as WebhookComment)).toBe(true);
    });

    it('recognizes implementation plan header', () => {
      const comment: Partial<WebhookComment> = {
        author: { name: 'User' },
        body: "Ralph's Implementation Plan"
      };
      expect(isRalphOwnComment(comment as WebhookComment)).toBe(true);
    });
  });

  describe('isInReviewState', () => {
    it('recognizes in review', () => expect(isInReviewState('In Review')).toBe(true));
    it('recognizes Peer Review', () => expect(isInReviewState('Peer Review')).toBe(true));
    it('rejects other states', () => expect(isInReviewState('Todo')).toBe(false));
  });

  describe('isAlreadyProcessing', () => {
    it('recognizes in progress', () => expect(isAlreadyProcessing('In Progress')).toBe(true));
    it('recognizes in review', () => expect(isAlreadyProcessing('In Review')).toBe(true));
    it('rejects todo', () => expect(isAlreadyProcessing('Todo')).toBe(false));
  });

  describe('routeComment', () => {
    const mockComment: WebhookComment = {
      id: 'c1',
      body: 'feedback',
      author: { name: 'User' },
      issue: { id: 'i1', state: { name: 'Todo' } }
    };

    const mockStoredPlan: StoredPlanContext = {
      plan: 'the plan',
      taskContext: {
        ticketId: 'i1',
        title: 'title',
        repoUrl: 'repo',
        branchName: 'branch'
      },
      feedbackHistory: []
    };

    it('ignores Ralph own comments', () => {
      const comment = { ...mockComment, author: { name: 'Ralph' } };
      expect(routeComment(comment, null)).toEqual({ action: 'ignore', reason: 'ralph-comment' });
    });

    it('approves if plan exists and comment is LGTM', () => {
      const comment = { ...mockComment, body: 'LGTM' };
      expect(routeComment(comment, mockStoredPlan)).toEqual({ action: 'approve', storedPlan: mockStoredPlan });
    });

    it('ignores approval if already processing', () => {
      const comment = { ...mockComment, body: 'LGTM', issue: { id: 'i1', state: { name: 'In Progress' } } };
      expect(routeComment(comment, mockStoredPlan)).toEqual({ action: 'ignore', reason: 'already-processed' });
    });

    it('revises if plan exists and comment is not approval', () => {
      const comment = { ...mockComment, body: 'please fix this' };
      expect(routeComment(comment, mockStoredPlan)).toEqual({
        action: 'revise',
        storedPlan: mockStoredPlan,
        feedback: 'please fix this'
      });
    });

    it('iterates if no plan but in review state', () => {
      const comment = { ...mockComment, body: 'bug found', issue: { id: 'i1', state: { name: 'In Review' }, identifier: 'PROJ-1' } };
      expect(routeComment(comment, null)).toEqual({
        action: 'iterate',
        issueId: 'i1',
        issueTitle: 'Iterative fix',
        issueDescription: undefined,
        teamKey: undefined,
        identifier: 'PROJ-1',
        feedback: 'bug found'
      });
    });

    it('ignores if no plan and not in review', () => {
      expect(routeComment(mockComment, null)).toEqual({ action: 'ignore', reason: 'no-stored-plan' });
    });
  });
});
