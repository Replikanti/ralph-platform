/**
 * Common mock factories for tests
 * Reduces duplication across test files
 */

/**
 * Creates mock for Ts.ED decorators
 * Used in all service and controller tests
 */
export function mockTsEdDecorators() {
    return {
        '@tsed/common': {
            Controller: () => (target: any) => target,
            Service: () => (target: any) => target,
            Middleware: () => (target: any) => target,
            Get: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
            Post: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
            Req: () => (target: any, propertyKey: string, index: number) => {},
            Res: () => (target: any, propertyKey: string, index: number) => {},
            BodyParams: () => (target: any, propertyKey: string, index: number) => {},
            HeaderParams: () => (target: any, propertyKey: string, index: number) => {},
            UseBefore: () => (target: any) => target,
            Inject: () => (target: any, propertyKey: string) => {},
            OnInit: jest.fn(),
            OnDestroy: jest.fn(),
            PlatformApplication: jest.fn(),
            Configuration: () => (target: any) => target,
        },
        '@tsed/di': {
            Inject: () => (target: any, propertyKey: string) => {},
        },
        '@tsed/logger': {
            Logger: jest.fn().mockImplementation(() => ({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            })),
        },
        '@tsed/exceptions': {
            Unauthorized: class Unauthorized extends Error {
                constructor(message: string) {
                    super(message);
                    this.name = 'Unauthorized';
                }
            },
        },
    };
}

/**
 * Creates mock Redis connection
 */
export function createMockRedis() {
    return {
        connection: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            ping: jest.fn().mockResolvedValue('PONG'),
            on: jest.fn(),
            quit: jest.fn().mockResolvedValue(undefined),
        },
    };
}

/**
 * Creates mock BullMQ Queue
 */
export function createMockQueue() {
    return {
        add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
        close: jest.fn().mockResolvedValue(undefined),
        getJob: jest.fn(),
        getJobs: jest.fn().mockResolvedValue([]),
    };
}

/**
 * Creates mock Linear client
 */
export function createMockLinearClient() {
    return {
        updateIssueState: jest.fn().mockResolvedValue(true),
        postComment: jest.fn().mockResolvedValue(undefined),
        getIssueState: jest.fn().mockResolvedValue('Todo'),
        isEnabled: jest.fn().mockReturnValue(true),
        updateIssueWithComment: jest.fn().mockResolvedValue(undefined),
    };
}

/**
 * Creates mock Langfuse client
 */
export function createMockLangfuse() {
    const mockSpan = {
        generation: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
    };

    return {
        trace: jest.fn().mockReturnValue({
            span: jest.fn().mockReturnValue(mockSpan),
            update: jest.fn(),
        }),
        shutdown: jest.fn().mockResolvedValue(undefined),
        flushAsync: jest.fn().mockResolvedValue(undefined),
    };
}

/**
 * Creates mock Anthropic client
 */
export function createMockAnthropic() {
    return {
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'Test response' }],
                usage: { input_tokens: 100, output_tokens: 50 },
            }),
        },
    };
}

/**
 * Creates mock simple-git instance
 */
export function createMockGit() {
    return {
        clone: jest.fn().mockResolvedValue(undefined),
        checkout: jest.fn().mockResolvedValue(undefined),
        checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
        addConfig: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue({ commit: 'abc123' }),
        push: jest.fn().mockResolvedValue(undefined),
        status: jest.fn().mockResolvedValue({ modified: [], created: [] }),
    };
}
