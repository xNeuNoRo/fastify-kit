import { parentPort } from "node:worker_threads";
import { FastifyKit } from "../../../../src/core/FastifyKit.js";
import { Module } from "../../../../src/core/module.decorator.js";
import { getEventBus } from "../../../../src/events/eventbus.factory.js";

@Module({})
class SecondaryModule {}

async function bootstrap() {
  try {
    const app = await FastifyKit.create({
      module: SecondaryModule,
      distributed: {
        redis: { host: "localhost", port: 6379 },
        features: { eventBus: true },
      },
    });

    const eventBus = getEventBus();
    const waitUntilReady = (
      eventBus as typeof eventBus & { waitUntilReady?: () => Promise<void> }
    ).waitUntilReady;
    if (waitUntilReady) await waitUntilReady.call(eventBus);

    // Escuchamos el evento distribuido usando la API directa para mayor estabilidad en el Worker Thread
    eventBus.on("distributed.sync.test", (payload: any) => {
      parentPort?.postMessage({ type: "event_received", payload });
    });

    parentPort?.postMessage({ type: "ready" });

    parentPort?.on("message", async (msg) => {
      if (msg === "shutdown") {
        await app.close();
        process.exit(0);
      }
    });
  } catch (err) {
    console.error("Secondary Worker Bootstrap Error:", err);
    process.exit(1);
  }
}

try {
  await bootstrap();
} catch (err) {
  console.error("Secondary Worker Critical Error:", err);
  process.exit(1);
}
