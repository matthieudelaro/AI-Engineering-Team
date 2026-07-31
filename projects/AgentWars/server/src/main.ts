import { createApp } from "./http/app.js";
import { bootstrapFromEnv } from "./store.js";

export async function startServer(): Promise<void> {
  bootstrapFromEnv();
  const port = Number(process.env.PORT ?? 8000);
  const app = await createApp({ logger: true });
  await app.listen({ port, host: "0.0.0.0" });
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/src/index.ts") ||
    process.argv[1].endsWith("/src/main.ts") ||
    process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("/main.js"));

if (isMain) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
