// Bun test preload — runs before every test file in each worker.
// Set env vars and register critical mocks here so they are in place BEFORE any
// module from node_modules is first imported (server.ts init time).
import { mock } from 'bun:test';

process.env.LINEAR_WEBHOOK_SECRET = 'test-linear-webhook-secret-12345678';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'password';
process.env.REDIS_URL = 'redis://localhost:6379';

// ── IORedis — must be mocked before server.ts creates its connection ──────────
mock.module('ioredis', () => ({
    default: mock().mockImplementation(() => ({
        on: mock(),
        get: mock().mockResolvedValue(null),
        set: mock().mockResolvedValue('OK'),
        quit: mock().mockResolvedValue('OK'),
        disconnect: mock(),
    })),
}));

// ── BullMQ Queue — must be mocked so queue.add() resolves immediately ─────────
mock.module('bullmq', () => ({
    Queue: mock().mockImplementation(() => ({
        add: mock().mockResolvedValue({ id: 'job-mock' }),
        close: mock().mockResolvedValue(undefined),
    })),
    Worker: mock(),
    QueueEvents: mock(),
}));

// ── Bull Board — UI adapter wiring used at server init ────────────────────────
mock.module('@bull-board/api', () => ({
    createBullBoard: mock(),
}));
mock.module('@bull-board/api/bullMQAdapter', () => ({
    BullMQAdapter: mock(),
}));
mock.module('@bull-board/express', () => ({
    ExpressAdapter: mock().mockImplementation(() => ({
        setBasePath: mock(),
        getRouter: mock().mockReturnValue((_req: any, _res: any, next: any) => next()),
    })),
}));
