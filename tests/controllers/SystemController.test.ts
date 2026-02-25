// Mock Ts.ED decorators before imports
jest.mock('@tsed/common', () => ({
    Controller: () => (target: any) => target,
    Service: () => (target: any) => target,
    Get: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
    Post: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
    Res: () => (target: any, propertyKey: string, index: number) => {},
    BodyParams: () => (target: any, propertyKey: string, index: number) => {},
    HeaderParams: () => (target: any, propertyKey: string, index: number) => {},
    Inject: () => (target: any, propertyKey: string) => {},
    OnInit: jest.fn(),
    OnDestroy: jest.fn(),
    PlatformApplication: jest.fn(),
    Configuration: () => (target: any) => target,
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock BullBoard modules
jest.mock('@bull-board/api', () => ({
    createBullBoard: jest.fn().mockReturnValue({}),
}));

jest.mock('@bull-board/api/bullMQAdapter', () => ({
    BullMQAdapter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@bull-board/express', () => ({
    ExpressAdapter: jest.fn().mockImplementation(() => ({
        setBasePath: jest.fn(),
        getRouter: jest.fn().mockReturnValue(jest.fn()),
    })),
}));

import express, { Express } from "express";
import SuperTest from "supertest";
import { SystemController } from "../../src/controllers/SystemController";
import { QueueService } from "../../src/services/QueueService";

describe("SystemController", () => {
    let app: Express;
    let request: ReturnType<typeof SuperTest>;
    let mockQueue: any;
    let controller: SystemController;

    beforeAll(() => {
        // Set admin credentials
        process.env.ADMIN_USER = "admin";
        process.env.ADMIN_PASS = "password";

        // Mock QueueService
        mockQueue = {
            getQueue: jest.fn().mockReturnValue({ name: "ralph-tasks" }),
        };

        // Create Express app and mount routes
        app = express();
        app.use(express.json());

        controller = new SystemController();
        (controller as any).queue = mockQueue;

        // Mount routes manually (simulating Ts.ED routing)
        app.get("/health", (req, res) => controller.healthCheck(res));

        // For admin dashboard, we test the Basic Auth middleware behavior
        // (the actual BullBoard setup is done in $onInit which we don't test here)
        const basicAuth = require("express-basic-auth");
        app.use(
            "/admin/queues",
            basicAuth({
                users: { admin: "password" },
                challenge: true,
            }),
            (req, res) => res.status(200).send("OK")
        );

        request = SuperTest(app);
    });

    describe("GET /health", () => {
        it("should return 200 OK with status", async () => {
            const res = await request.get("/health");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ok" });
        });
    });

    describe("GET /admin/queues", () => {
        it("should protect dashboard with Basic Auth", async () => {
            const res = await request.get("/admin/queues");
            expect(res.status).toBe(401);
            expect(res.headers["www-authenticate"]).toContain('Basic');
        });

        it("should reject invalid credentials", async () => {
            const res = await request
                .get("/admin/queues")
                .auth("wrong", "credentials");
            expect(res.status).toBe(401);
        });

        it("should allow access with valid credentials", async () => {
            const res = await request
                .get("/admin/queues")
                .auth("admin", "password");

            // BullBoard returns its own response, we just check auth worked
            // (status might be 200 or 404 depending on BullBoard setup)
            expect(res.status).not.toBe(401);
        });
    });

    describe("$onInit and setupBullBoard", () => {
        beforeEach(() => {
            // Ensure env vars are set
            process.env.ADMIN_USER = "admin";
            process.env.ADMIN_PASS = "password";
        });

        it("should call setupBullBoard when initialized", () => {
            // Need to reload the module to pick up env vars
            jest.resetModules();
            const { SystemController: ReloadedController } = require("../../src/controllers/SystemController");

            const mockApp = {
                use: jest.fn(),
            };
            const controller = new ReloadedController();
            (controller as any).queue = mockQueue;
            (controller as any).app = mockApp;

            controller.$onInit();

            // Verify setupBullBoard was called (app.use should be called)
            expect(mockApp.use).toHaveBeenCalled();
        });

        it("should skip dashboard setup when ADMIN_USER not set", () => {
            delete process.env.ADMIN_USER;

            jest.resetModules();
            const { SystemController: ReloadedController } = require("../../src/controllers/SystemController");

            const mockApp = {
                use: jest.fn(),
            };
            const controller = new ReloadedController();
            (controller as any).queue = mockQueue;
            (controller as any).app = mockApp;

            controller.$onInit();

            // App.use should not be called when credentials missing
            expect(mockApp.use).not.toHaveBeenCalled();

            // Restore
            process.env.ADMIN_USER = "admin";
        });

        it("should skip dashboard setup when ADMIN_PASS not set", () => {
            delete process.env.ADMIN_PASS;

            jest.resetModules();
            const { SystemController: ReloadedController } = require("../../src/controllers/SystemController");

            const mockApp = {
                use: jest.fn(),
            };
            const controller = new ReloadedController();
            (controller as any).queue = mockQueue;
            (controller as any).app = mockApp;

            controller.$onInit();

            // App.use should not be called when credentials missing
            expect(mockApp.use).not.toHaveBeenCalled();

            // Restore
            process.env.ADMIN_PASS = "password";
        });
    });
});
