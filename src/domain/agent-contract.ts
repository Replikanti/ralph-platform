import type { Task, AgentResult } from './types';

/**
 * Contract that every agent implementation must satisfy.
 * Platform layer depends only on this interface, not on the concrete implementation.
 */
export interface IAgent {
    run(task: Task): Promise<AgentResult>;
}
