import { parseEnv } from './env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[api] boot failed: ${msg}\n`);
    process.exit(1);
  }

  const app = await buildServer({ env });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown requested');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'listen failed');
    process.exit(1);
  }
}

void main();
