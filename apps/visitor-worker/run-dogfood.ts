import { Pool } from 'pg';
import { LocalCliProvider } from '@willbuy/llm-adapter';
import { runVisitorPollingLoop } from './src/poller.ts';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) { process.stderr.write('DATABASE_URL required\n'); process.exit(1); }

const captureBasePath = process.env['CAPTURE_STORAGE_PATH'] ?? '/tmp/willbuy/captures';

const storage = {
  async get(key: string): Promise<Buffer> { return readFile(join(captureBasePath, key)); },
  async has(key: string): Promise<boolean> {
    try { await stat(join(captureBasePath, key)); return true; }
    catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  },
  async put(): Promise<void> { throw new Error('read-only'); },
};

const pool = new Pool({ connectionString: dbUrl });
const provider = new LocalCliProvider();
const ac = new AbortController();

process.on('SIGTERM', () => ac.abort());
process.on('SIGINT', () => ac.abort());

process.stdout.write('[visitor-worker-dogfood] starting...\n');
await runVisitorPollingLoop({ pool, storage, provider, signal: ac.signal });
await pool.end();
process.stdout.write('[visitor-worker-dogfood] done\n');
