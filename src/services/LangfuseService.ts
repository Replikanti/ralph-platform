import { Service, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { Langfuse } from "langfuse";

@Service()
export class LangfuseService implements OnDestroy {
    private langfuse: Langfuse;
    private logger = new Logger("LangfuseService");

    constructor() {
        // Langfuse reads LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_HOST
        // from environment automatically
        this.langfuse = new Langfuse();
    }

    async $onDestroy(): Promise<void> {
        await this.langfuse.flushAsync();
        this.logger.info("Langfuse flushed on shutdown");
    }

    /**
     * Execute a function within a Langfuse trace.
     * Automatically captures errors and flushes on completion.
     *
     * Replaces the `withTrace` helper from agent.ts.
     */
    async withTrace<T>(
        name: string,
        metadata: Record<string, any>,
        fn: (trace: any) => Promise<T>
    ): Promise<T> {
        const trace = this.langfuse.trace({ name, metadata });
        try {
            return await fn(trace);
        } catch (e: any) {
            trace.update({ metadata: { error: e.message } });
            throw e;
        } finally {
            await this.langfuse.flushAsync();
        }
    }
}
