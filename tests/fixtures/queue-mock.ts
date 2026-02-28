/**
 * Shared BullMQ Queue mock instances.
 *
 * Imported by both tests/setup.ts (preload) and individual test files so that
 * the *same* function object is used by both the bullmq module factory and any
 * test that needs to inspect or override queue calls.
 */
import { mock } from 'bun:test';

export const mockQueueAdd   = mock().mockResolvedValue({ id: 'job-mock' });
export const mockQueueClose = mock().mockResolvedValue(undefined);
