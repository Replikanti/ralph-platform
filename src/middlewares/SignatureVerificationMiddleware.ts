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
