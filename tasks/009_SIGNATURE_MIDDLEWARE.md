# Task 009: Create Signature Verification Middleware

## Objective
Extract the HMAC SHA-256 webhook signature verification logic from `server.ts` into a reusable Ts.ED middleware.

## Prerequisites
- 003 (env config with `LINEAR_WEBHOOK_SECRET`)
- 005 (Server.ts with raw body capture configured)

## Reference Files
- `src/server.ts` lines 135-156 (`verifyLinearSignature` function)

## Deliverables
- `src/middlewares/SignatureVerificationMiddleware.ts`

## Instructions

```typescript
import { Middleware, Req } from "@tsed/common";
import { Unauthorized } from "@tsed/exceptions";
import crypto from "node:crypto";
import { LINEAR_WEBHOOK_SECRET } from "../config/env";

@Middleware()
export class SignatureVerificationMiddleware {
    use(@Req() req: any): void {
        if (!LINEAR_WEBHOOK_SECRET) {
            throw new Unauthorized("LINEAR_WEBHOOK_SECRET is not configured");
        }

        const signature = req.headers["linear-signature"];
        if (!signature || typeof signature !== "string") {
            throw new Unauthorized("Missing linear-signature header");
        }

        const hmac = crypto.createHmac("sha256", LINEAR_WEBHOOK_SECRET);
        const digest = hmac.update(req.rawBody || "").digest("hex");

        const signatureBuffer = Buffer.from(signature);
        const digestBuffer = Buffer.from(digest);

        if (signatureBuffer.length !== digestBuffer.length) {
            throw new Unauthorized("Invalid webhook signature");
        }

        if (!crypto.timingSafeEqual(signatureBuffer, digestBuffer)) {
            throw new Unauthorized("Invalid webhook signature");
        }
    }
}
```

### Critical Details

1. **`req.rawBody`**: This is set by the `express.json({ verify: ... })` middleware configured in `Server.ts` (Task 005). The raw body buffer is essential for HMAC verification - the parsed JSON body would produce a different hash.
2. **Timing-safe comparison**: Uses `crypto.timingSafeEqual()` to prevent timing attacks. This matches the exact pattern from the current `verifyLinearSignature`.
3. **Length check first**: Buffer lengths must match before calling `timingSafeEqual()` (it throws on mismatched lengths).
4. **Ts.ED `Unauthorized`**: Instead of `res.status(401).send()`, we throw a Ts.ED exception. Ts.ED's global exception handler will format the response automatically.

### Important Notes

- The middleware is applied per-controller using `@UseBefore(SignatureVerificationMiddleware)` in the WebhookController (Task 015).
- It is NOT applied globally - the `/health` and `/admin/queues` endpoints must not require webhook signatures.

## Acceptance Criteria
- [ ] `src/middlewares/SignatureVerificationMiddleware.ts` exists with `@Middleware()` decorator
- [ ] Uses `crypto.timingSafeEqual` for timing-safe comparison
- [ ] Reads `req.rawBody` (set by Server.ts express.json verify callback)
- [ ] Throws `Unauthorized` from `@tsed/exceptions` on failure
- [ ] Uses `LINEAR_WEBHOOK_SECRET` from `config/env.ts`
- [ ] `npm run build` compiles without errors
