// Mock Ts.ED decorators
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    OnDestroy: jest.fn(),
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock Langfuse
const mockTrace = jest.fn();
const mockFlushAsync = jest.fn();
const mockLangfuse = jest.fn().mockImplementation(() => ({
    trace: mockTrace,
    flushAsync: mockFlushAsync,
}));

jest.mock('langfuse', () => ({
    Langfuse: mockLangfuse,
}));

import { LangfuseService } from '../../src/services/LangfuseService';

describe('LangfuseService', () => {
    let service: LangfuseService;
    let mockTraceObj: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockTraceObj = {
            update: jest.fn(),
            span: jest.fn(),
        };

        mockTrace.mockReturnValue(mockTraceObj);
        mockFlushAsync.mockResolvedValue(undefined);

        service = new LangfuseService();
    });

    describe('constructor', () => {
        it('should initialize Langfuse', () => {
            expect(mockLangfuse).toHaveBeenCalled();
        });
    });

    describe('$onDestroy', () => {
        it('should flush Langfuse on destroy', async () => {
            await service.$onDestroy();

            expect(mockFlushAsync).toHaveBeenCalled();
        });

        it('should log flush operation', async () => {
            const loggerSpy = jest.spyOn((service as any).logger, 'info');

            await service.$onDestroy();

            expect(loggerSpy).toHaveBeenCalledWith('Langfuse flushed on shutdown');
        });
    });

    describe('withTrace', () => {
        it('should create trace with name and metadata', async () => {
            const fn = jest.fn().mockResolvedValue('result');

            await service.withTrace('test-trace', { key: 'value' }, fn);

            expect(mockTrace).toHaveBeenCalledWith({
                name: 'test-trace',
                metadata: { key: 'value' },
            });
        });

        it('should execute function with trace object', async () => {
            const fn = jest.fn().mockResolvedValue('result');

            const result = await service.withTrace('test', {}, fn);

            expect(fn).toHaveBeenCalledWith(mockTraceObj);
            expect(result).toBe('result');
        });

        it('should flush after successful execution', async () => {
            const fn = jest.fn().mockResolvedValue('result');

            await service.withTrace('test', {}, fn);

            expect(mockFlushAsync).toHaveBeenCalled();
        });

        it('should update trace with error on failure', async () => {
            const error = new Error('Test error');
            const fn = jest.fn().mockRejectedValue(error);

            await expect(service.withTrace('test', {}, fn)).rejects.toThrow('Test error');

            expect(mockTraceObj.update).toHaveBeenCalledWith({
                metadata: { error: 'Test error' },
            });
        });

        it('should flush even after error', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('Test error'));

            try {
                await service.withTrace('test', {}, fn);
            } catch (e) {
                // Expected
            }

            expect(mockFlushAsync).toHaveBeenCalled();
        });

        it('should rethrow errors', async () => {
            const error = new Error('Custom error');
            const fn = jest.fn().mockRejectedValue(error);

            await expect(service.withTrace('test', {}, fn)).rejects.toThrow('Custom error');
        });

        it('should handle async functions', async () => {
            const fn = jest.fn().mockImplementation(async (trace) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'async result';
            });

            const result = await service.withTrace('async-test', {}, fn);

            expect(result).toBe('async result');
            expect(mockFlushAsync).toHaveBeenCalled();
        });
    });
});
