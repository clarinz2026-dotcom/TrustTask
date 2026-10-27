import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closePool } from "./db/pool.js";

const config = loadConfig();
const app = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, "Server failed to start");
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(closePool);
  });
}
