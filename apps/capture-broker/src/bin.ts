/**
 * Capture Broker — CLI entrypoint.
 *
 * Production: started by systemd `ExecStart=/usr/bin/node dist/bin.js`.
 * Environment is injected from `/etc/willbuy/broker.env` (provisioned
 * out-of-band via 1Password + scripts/push-secrets.sh; never in git).
 *
 * Flags:
 *   --smoke   Start on a temp socket, send one probe request, assert ack
 *             ok=true, then exit 0. Used by the N3 smoke test in CI and
 *             for local health-checks. No env vars required in smoke mode.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { Pool } from 'pg';
import { startBroker } from './server.js';
import { inMemoryStorage, localFileStorage } from './storage.js';
import { inMemoryCaptureStore, pgCaptureStore } from './captureStore.js';
import { frame, HEADER_BYTES } from './framing.js';
import type { BrokerAck } from './schema.js';

const SMOKE_FLAG = '--smoke';

if (process.argv.includes(SMOKE_FLAG)) {
  await runSmoke();
} else {
  await runProduction();
}

async function runSmoke(): Promise<void> {
  // Use in-memory doubles — no real Supabase or Postgres needed.
  const socketPath = join(tmpdir(), `wb-broker-smoke-${process.pid}.sock`);
  const handle = await startBroker({
    storage: inMemoryStorage(),
    store: inMemoryCaptureStore(),
    socketPath,
    frameTimeoutMs: 5_000,
  });

  // Send one valid probe request.
  const probeTree = JSON.stringify({ role: 'document', name: 'smoke', children: [] });
  const probeReq = JSON.stringify({
    status: 'ok',
    a11y_tree_b64: Buffer.from(probeTree, 'utf8').toString('base64'),
    banner_selectors_matched: [],
    overlays_unknown_present: false,
    host_count: 0,
  });

  const ack = await sendProbe(socketPath, probeReq);

  await handle.close();

  if (!ack.ok) {
    process.stderr.write(`smoke: broker returned error: ${JSON.stringify(ack)}\n`);
    process.exit(1);
  }

  process.stdout.write(`smoke: ok capture_id=${ack.capture_id}\n`);
  process.exit(0);
}

function sendProbe(socketPath: string, payload: string): Promise<BrokerAck> {
  return new Promise<BrokerAck>((resolve, reject) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    socket.on('error', reject);
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => {
      const all = Buffer.concat(chunks);
      if (all.length < HEADER_BYTES) {
        reject(new Error(`smoke probe: broker sent ${all.length}B, expected framed response`));
        return;
      }
      const len = all.readUInt32BE(0);
      const body = all.slice(HEADER_BYTES, HEADER_BYTES + len);
      try {
        resolve(JSON.parse(body.toString('utf8')) as BrokerAck);
      } catch (e) {
        reject(e);
      }
    });
    socket.on('connect', () => {
      socket.write(frame(Buffer.from(payload, 'utf8')));
      socket.end();
    });
  });
}

async function runProduction(): Promise<void> {
  // Production wiring: local-fs artifact storage + Postgres capture store.
  const socketPath = process.env['BROKER_SOCKET_PATH'] ?? '/run/willbuy/broker.sock';

  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    process.stderr.write('[willbuy-capture-broker] DATABASE_URL is required\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const captureBasePath = process.env['CAPTURE_STORAGE_PATH'] ?? '/tmp/willbuy/captures';
  const storage = localFileStorage(captureBasePath);
  const store = pgCaptureStore(pool);

  process.stdout.write(`[willbuy-capture-broker] starting on ${socketPath}\n`);
  process.stdout.write(`[willbuy-capture-broker] artifact storage: ${captureBasePath}\n`);

  const handle = await startBroker({ storage, store, socketPath });

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`[willbuy-capture-broker] ${signal} received, shutting down\n`);
    await handle.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
