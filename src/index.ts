#!/usr/bin/env node
import { getConfig } from "./config.js";
import { bootstrapDataDir } from "./app/bootstrap.js";
import { SessionService } from "./application/sessionService.js";
import { createSessionServer } from "./server/sessionServer.js";
import { JevClient } from "./jev.js";
async function main() {
  const command = process.argv[2] || "app";
  if (command !== "app") {
    console.log(
      "Claudex — pedidos e agentes trabalhando diretamente nas suas pastas.\n\nUse npm run app para o desktop ou npm run app:web para o navegador.",
    );
    return;
  }
  const config = getConfig();
  await bootstrapDataDir(config.projectRoot, config.dataDir, config.logsDir);
  const sessions = new SessionService(config.dataDir, config, new JevClient(config));
  await sessions.load();
  const app = createSessionServer({ sessions, config });
  const port = await app.listen(config.wsPort);
  console.log(`Claudex: http://127.0.0.1:${port}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
