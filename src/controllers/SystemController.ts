import { Controller, Get, Res, Inject, PlatformApplication } from "@tsed/common";
import { OnInit } from "@tsed/common";
import { Logger } from "@tsed/logger";
import express from "express";
import basicAuth from "express-basic-auth";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { QueueService } from "../services/QueueService";
import { ADMIN_USER, ADMIN_PASS } from "../config/env";

@Controller("/")
export class SystemController implements OnInit {
    private logger = new Logger("SystemController");

    @Inject() private queue!: QueueService;
    @Inject() private app!: PlatformApplication;

    $onInit(): void {
        this.setupBullBoard();
    }

    @Get("/health")
    healthCheck(@Res() res: express.Response) {
        return res.status(200).send({ status: "ok" });
    }

    private setupBullBoard(): void {
        if (!ADMIN_USER || !ADMIN_PASS) {
            this.logger.warn("ADMIN_USER or ADMIN_PASS not set. Dashboard is disabled.");
            return;
        }

        const serverAdapter = new ExpressAdapter();
        serverAdapter.setBasePath("/admin/queues");

        createBullBoard({
            queues: [new BullMQAdapter(this.queue.getQueue())],
            serverAdapter,
        });

        this.app.use(
            "/admin/queues",
            basicAuth({
                users: { [ADMIN_USER]: ADMIN_PASS },
                challenge: true,
            }),
            serverAdapter.getRouter()
        );

        this.logger.info("Admin dashboard enabled at /admin/queues");
    }
}
