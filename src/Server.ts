import { Configuration, Inject, PlatformApplication } from "@tsed/common";
import "@tsed/swagger";
import helmet from "helmet";
import morgan from "morgan";
import express from "express";
import { RedisProvider } from "./services/RedisProvider";

@Configuration({
    port: 3000,
    acceptMimes: ["application/json"],
    swagger: [
        {
            path: "/api-docs",
            specVersion: "3.0.1",
        },
    ],
    imports: [
        RedisProvider,
    ],
})
export class Server {
    @Inject()
    private readonly app!: PlatformApplication;

    /**
     * Called before routes are loaded.
     * Configure global Express middleware here.
     */
    $beforeRoutesInit(): void {
        // Security headers
        this.app.use(helmet());

        // HTTP request logging
        this.app.use(morgan("combined"));

        // JSON body parser with raw body capture for HMAC signature verification.
        // CRITICAL: The raw body buffer must be captured BEFORE any JSON parsing.
        // This is the same pattern as the current server.ts lines 128-133.
        this.app.use(
            express.json({
                limit: "10mb",
                verify: (req: any, _res: express.Response, buf: Buffer) => {
                    req.rawBody = buf;
                },
            })
        );
    }
}
