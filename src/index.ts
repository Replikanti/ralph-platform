import "reflect-metadata";
import { PlatformExpress } from "@tsed/platform-express";
import { Server } from "./Server";

async function bootstrap() {
    const platform = await PlatformExpress.bootstrap(Server);
    await platform.listen();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`${signal} received. Shutting down...`);
        await platform.stop();
        process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => { // NOSONAR - Top-level await not supported in CommonJS
    console.error("Failed to start server:", err);
    process.exit(1);
});
