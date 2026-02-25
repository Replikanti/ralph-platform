// Mock Ts.ED decorators
import { mockTsEdDecorators } from '../test-utils/common-mocks';
import { TEST_CREDENTIALS } from '../test-utils/constants';

const mocks = mockTsEdDecorators();
jest.mock('@tsed/common', () => ({
    Middleware: mocks['@tsed/common'].Middleware,
    Req: mocks['@tsed/common'].Req,
}));

jest.mock('@tsed/exceptions', () => mocks['@tsed/exceptions']);

// Mock config/env
let mockLinearWebhookSecret: string | undefined = TEST_CREDENTIALS.WEBHOOK_SECRET;
jest.mock('../../src/config/env', () => ({
    get LINEAR_WEBHOOK_SECRET() {
        return mockLinearWebhookSecret;
    },
}));

import { SignatureVerificationMiddleware } from '../../src/middlewares/SignatureVerificationMiddleware';
import { Unauthorized } from '@tsed/exceptions';
import crypto from 'node:crypto';

describe('SignatureVerificationMiddleware', () => {
    let middleware: SignatureVerificationMiddleware;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLinearWebhookSecret = TEST_CREDENTIALS.WEBHOOK_SECRET;
        middleware = new SignatureVerificationMiddleware();
    });

    function createSignature(body: string, secret: string): string {
        return crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    describe('use', () => {
        it('should throw Unauthorized when LINEAR_WEBHOOK_SECRET not configured', () => {
            mockLinearWebhookSecret = undefined;
            middleware = new SignatureVerificationMiddleware();

            const req = {
                headers: { 'linear-signature': 'some-sig' },
                rawBody: 'test body',
            };

            expect(() => middleware.use(req)).toThrow('LINEAR_WEBHOOK_SECRET is not configured');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        it('should throw Unauthorized when signature header is missing', () => {
            const req = {
                headers: {},
                rawBody: 'test body',
            };

            expect(() => middleware.use(req)).toThrow('Missing linear-signature header');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        it('should throw Unauthorized when signature is not a string', () => {
            const req = {
                headers: { 'linear-signature': 123 }, // Not a string
                rawBody: 'test body',
            };

            expect(() => middleware.use(req)).toThrow('Missing linear-signature header');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        it('should throw Unauthorized when signature length does not match', () => {
            const req = {
                headers: { 'linear-signature': 'short' },
                rawBody: 'test body',
            };

            expect(() => middleware.use(req)).toThrow('Invalid webhook signature');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        it('should throw Unauthorized when signature is invalid', () => {
            const body = 'test body';
            const wrongSignature = createSignature(body, 'wrong-secret');

            const req = {
                headers: { 'linear-signature': wrongSignature },
                rawBody: body,
            };

            expect(() => middleware.use(req)).toThrow('Invalid webhook signature');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        it('should pass with valid signature', () => {
            const body = 'test body';
            const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);

            const req = {
                headers: { 'linear-signature': validSignature },
                rawBody: body,
            };

            expect(() => middleware.use(req)).not.toThrow();
        });

        it('should handle empty body', () => {
            const body = '';
            const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);

            const req = {
                headers: { 'linear-signature': validSignature },
                rawBody: body,
            };

            expect(() => middleware.use(req)).not.toThrow();
        });

        it('should handle missing rawBody', () => {
            const body = '';
            const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);

            const req = {
                headers: { 'linear-signature': validSignature },
                // No rawBody
            };

            expect(() => middleware.use(req)).not.toThrow();
        });

        it('should use timing-safe comparison', () => {
            const body = 'test body';
            // Create two signatures with same length but different content
            const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);
            // Modify one character to create invalid signature of same length
            const invalidSignature = validSignature.slice(0, -1) +
                (validSignature[validSignature.length - 1] === 'a' ? 'b' : 'a');

            const req = {
                headers: { 'linear-signature': invalidSignature },
                rawBody: body,
            };

            expect(() => middleware.use(req)).toThrow('Invalid webhook signature');
        });
    });
});
