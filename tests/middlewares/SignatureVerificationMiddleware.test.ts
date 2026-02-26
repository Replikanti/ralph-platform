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

function createSignature(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function createRequest(signature: string | number, body?: string) {
    const req: any = { headers: { 'linear-signature': signature } };
    if (body !== undefined) req.rawBody = body;
    return req;
}

describe('SignatureVerificationMiddleware', () => {
    let middleware: SignatureVerificationMiddleware;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLinearWebhookSecret = TEST_CREDENTIALS.WEBHOOK_SECRET;
        middleware = new SignatureVerificationMiddleware();
    });

    describe('use', () => {
        it('should throw Unauthorized when LINEAR_WEBHOOK_SECRET not configured', () => {
            mockLinearWebhookSecret = undefined;
            middleware = new SignatureVerificationMiddleware();
            const req = createRequest('some-sig', 'test body');

            expect(() => middleware.use(req)).toThrow('LINEAR_WEBHOOK_SECRET is not configured');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        describe('signature validation errors', () => {
            test.each([
                ['not a string', 123, 'test body', 'Missing linear-signature header'],
                ['wrong length', 'short', 'test body', 'Invalid webhook signature'],
            ])('should throw Unauthorized when signature is %s', (_, signature, body, errorMsg) => {
                const req = createRequest(signature, body);

                expect(() => middleware.use(req)).toThrow(errorMsg);
                expect(() => middleware.use(req)).toThrow(Unauthorized);
            });

            it('should throw Unauthorized when signature header is missing', () => {
                const req: any = { headers: {}, rawBody: 'test body' };

                expect(() => middleware.use(req)).toThrow('Missing linear-signature header');
                expect(() => middleware.use(req)).toThrow(Unauthorized);
            });
        });

        it('should throw Unauthorized when signature is invalid', () => {
            const body = 'test body';
            const wrongSignature = createSignature(body, 'wrong-secret');
            const req = createRequest(wrongSignature, body);

            expect(() => middleware.use(req)).toThrow('Invalid webhook signature');
            expect(() => middleware.use(req)).toThrow(Unauthorized);
        });

        describe('valid signatures', () => {
            test.each([
                ['with body', 'test body'],
                ['with empty body', ''],
            ])('should pass %s', (_, body) => {
                const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);
                const req = createRequest(validSignature, body);

                expect(() => middleware.use(req)).not.toThrow();
            });

            it('should handle missing rawBody', () => {
                const body = '';
                const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);
                const req: any = { headers: { 'linear-signature': validSignature } };

                expect(() => middleware.use(req)).not.toThrow();
            });
        });

        it('should use timing-safe comparison', () => {
            const body = 'test body';
            const validSignature = createSignature(body, TEST_CREDENTIALS.WEBHOOK_SECRET);
            // Modify one character to create invalid signature of same length
            const invalidSignature = validSignature.slice(0, -1) +
                (validSignature.endsWith('a') ? 'b' : 'a');
            const req = createRequest(invalidSignature, body);

            expect(() => middleware.use(req)).toThrow('Invalid webhook signature');
        });
    });
});
