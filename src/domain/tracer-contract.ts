/**
 * Minimal tracer interface — agent only knows about this, not about Langfuse.
 * Platform layer creates a concrete tracer and injects it into the agent.
 */
export interface ITracer {
    /** Wraps an async function in a named trace span. */
    span<T>(name: string, metadata: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
}

/** No-op implementation for tests and local runs without Langfuse. */
export const noopTracer: ITracer = {
    span: (_name, _meta, fn) => fn(),
};
