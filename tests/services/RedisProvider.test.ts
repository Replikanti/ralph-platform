// Mock Ts.ED decorators
import { mockTsEdDecorators } from '../test-utils/common-mocks';

const mocks = mockTsEdDecorators();
jest.mock('@tsed/common', () => ({
    ...mocks['@tsed/common'],
    OnInit: jest.fn(),
    OnDestroy: jest.fn(),
}));
jest.mock('@tsed/logger', () => mocks['@tsed/logger']);

// Mock ioredis
const mockRedisOn = jest.fn();
const mockRedisQuit = jest.fn();
const mockRedis = jest.fn().mockImplementation(() => ({
    on: mockRedisOn,
    quit: mockRedisQuit,
    status: 'ready',
}));

jest.mock('ioredis', () => mockRedis);

// Mock config/env
let mockRedisUrl = 'redis://localhost:6379';
jest.mock('../../src/config/env', () => ({
    get REDIS_URL() {
        return mockRedisUrl;
    },
}));

import { RedisProvider } from '../../src/services/RedisProvider';

function createProvider(init = false): RedisProvider {
    const p = new RedisProvider();
    if (init) p.$onInit();
    return p;
}

describe('RedisProvider', () => {
    let provider: RedisProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisUrl = 'redis://localhost:6379';
        mockRedisOn.mockImplementation((event, callback) => {
            // Immediately trigger connect event
            if (event === 'connect') {
                setTimeout(() => callback(), 1);
            }
        });
    });

    describe('$onInit', () => {
        it('should create Redis connection with URL from env', () => {
            provider = createProvider(true);

            expect(mockRedis).toHaveBeenCalledWith('redis://localhost:6379', {
                maxRetriesPerRequest: null,
                retryStrategy: expect.any(Function),
            });

            expect(mockRedisOn).toHaveBeenCalledWith('connect', expect.any(Function));
            expect(mockRedisOn).toHaveBeenCalledWith('error', expect.any(Function));
            expect(provider.connection).toBeDefined();
        });

        it('should log when Redis is connected', async () => {
            provider = createProvider();
            const loggerInfoSpy = jest.spyOn((provider as any).logger, 'info');
            provider.$onInit();

            // Wait for connect event to fire
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(loggerInfoSpy).toHaveBeenCalledWith('Connected to Redis');
        });

        it('should handle Redis errors', async () => {
            provider = createProvider();
            const loggerErrorSpy = jest.spyOn((provider as any).logger, 'error');

            mockRedisOn.mockImplementation((event, callback) => {
                if (event === 'error') {
                    setTimeout(() => callback(new Error('Connection failed')), 1);
                }
            });

            provider.$onInit();

            // Wait for error event to fire
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(loggerErrorSpy).toHaveBeenCalledWith('Redis connection error:', 'Connection failed');
        });
    });

    describe('retryStrategy', () => {
        it('should retry with exponential backoff up to 2 seconds', () => {
            provider = createProvider(true);

            const retryStrategy = (mockRedis as jest.Mock).mock.calls[0][1].retryStrategy;

            expect(retryStrategy(1)).toBe(Math.min(1 * 50, 2000)); // 50ms
            expect(retryStrategy(10)).toBe(Math.min(10 * 50, 2000)); // 500ms
            expect(retryStrategy(50)).toBe(2000); // Max 2 seconds
        });
    });

    describe('$onDestroy', () => {
        it('should close Redis connection on destroy', async () => {
            provider = createProvider(true);

            await provider.$onDestroy();

            expect(mockRedisQuit).toHaveBeenCalled();
        });

        it('should handle missing connection gracefully', async () => {
            provider = createProvider();
            // Don't call $onInit, so connection is undefined

            await expect(provider.$onDestroy()).resolves.not.toThrow();
        });
    });
});
