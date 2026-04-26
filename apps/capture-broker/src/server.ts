import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { CaptureRequest, type BrokerAck, type BrokerErrorCode } from './schema.js';
import { BYTE_CAPS, decodedBase64Bytes } from './byteCaps.js';
import { redact, REDACTOR_VERSION } from './redactor.js';
import { frame, readOneFrame, READ_TIMEOUT_MS } from './framing.js';
import type { ObjectStorage } from './storage.js';
import type { CaptureStore, PageCaptureRow } from './captureStore.js';

/** Socket inode mode required by spec §5.13: rw-rw---- (owner + group only). */
export const SOCKET_MODE = 0o660;

/**
 * Capture Broker — spec §5.13.
 *
 * - Listens on a Unix domain socket at `socketPath` (production:
 *   `/run/willbuy/broker.sock`). After `server.listen()` resolves,
 *   `chmodSync(socketPath, 0o660)` is called immediately — this overrides
 *   the process umask (systemd UMask=0007 would yield 0770 otherwise).
 *   Spec §5.13 requires mode 0660.
 * - Accepts ONE typed message per connection (single-shot framing).
 * - Schema-parses, byte-cap-enforces, redacts, persists artifact +
 *   `page_captures` row, returns ack, closes.
 *
 * Storage and DB are injected — production wires Supabase Storage + a
 * Postgres client; tests use the in-memory doubles in
 * `storage.ts` / `captureStore.ts`.
 */
export type BrokerDeps = {
  storage: ObjectStorage;
  store: CaptureStore;
  /** Spec §5.13: allow the socket path to be overridable for tests. */
  socketPath: string;
  /** ISO timestamp factory (test injection). */
  now?: () => string;
  /** Capture-id factory (test injection). */
  newId?: () => string;
  /**
   * Per-connection frame-read timeout in ms (N1). Defaults to
   * `READ_TIMEOUT_MS` (30 s). Tests inject a short value to avoid slow tests.
   */
  frameTimeoutMs?: number;
};

export type BrokerHandle = {
  server: Server;
  close(): Promise<void>;
};

export async function startBroker(deps: BrokerDeps): Promise<BrokerHandle> {
  // Ensure the socket path is clean before binding — Node refuses to
  // bind over an existing socket file.
  await unlink(deps.socketPath).catch(() => {});

  // `allowHalfOpen: true` — the worker writes its single message then
  // half-closes (FIN). Without this flag Node would auto-close the
  // server's writable side on 'end', so the broker could not write its
  // ack. Spec §5.13 requires the broker to ack before closing.
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    handleConnection(socket, deps).catch((err: unknown) => {
      // Last-ditch: write a structured error if the socket is still open,
      // then close. We never let a thrown promise rejection take down the
      // listener.
      try {
        const ack: BrokerAck = {
          ok: false,
          error: 'internal',
          detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        };
        socket.end(frame(Buffer.from(JSON.stringify(ack), 'utf8')));
      } catch {
        socket.destroy();
      }
    });
  });

  await new Promise<void>((ok, ko) => {
    server.once('error', ko);
    server.listen(deps.socketPath, () => {
      server.removeListener('error', ko);
      // Spec §5.13: socket inode MUST be mode 0660. Node creates the socket
      // with mode derived from process umask. The systemd unit sets
      // UMask=0007, which would yield 0770. We explicitly chmod to 0660
      // immediately after bind so the contract is enforced regardless of the
      // host umask.
      chmodSync(deps.socketPath, SOCKET_MODE);
      ok();
    });
  });

  return {
    server,
    async close() {
      await new Promise<void>((ok) => server.close(() => ok()));
      await unlink(deps.socketPath).catch(() => {});
    },
  };
}

async function handleConnection(socket: Socket, deps: BrokerDeps): Promise<void> {
  const sendAck = (ack: BrokerAck): void => {
    const buf = Buffer.from(JSON.stringify(ack), 'utf8');
    socket.end(frame(buf));
  };

  const sendError = (error: BrokerErrorCode, detail?: string): void => {
    sendAck(detail ? { ok: false, error, detail } : { ok: false, error });
  };

  const result = await readOneFrame(
    socket,
    BYTE_CAPS.MESSAGE_BYTES,
    deps.frameTimeoutMs ?? READ_TIMEOUT_MS,
  );
  socket.on('error', () => {}); // absorb EPIPE/ECONNRESET from ack write (Bun full-close)
  if (result.kind === 'too_big') {
    sendError('message_too_big', `declared ${result.declaredLen} > cap ${BYTE_CAPS.MESSAGE_BYTES}`);
    return;
  }
  if (result.kind === 'error' && result.message === 'timeout') {
    // N1: per-connection timeout expired. The socket was already destroyed by
    // readOneFrame; nothing left to do here.
    return;
  }
  if (result.kind === 'closed' || result.kind === 'error') {
    socket.destroy();
    return;
  }
  // Single-shot: any trailing bytes after the declared payload mean the
  // peer tried to send more than one message on the connection.
  if (result.trailingBytes > 0) {
    sendError('duplicate_message');
    return;
  }

  // Parse JSON
  let raw: unknown;
  try {
    raw = JSON.parse(result.payload.toString('utf8'));
  } catch (e) {
    sendError('malformed_json', e instanceof Error ? e.message : undefined);
    return;
  }

  // Schema-validate
  const parsed = CaptureRequest.safeParse(raw);
  if (!parsed.success) {
    sendError('schema_invalid', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 200));
    return;
  }
  const req = parsed.data;

  // Byte caps (defense-in-depth — spec §5.13)
  const a11yBytes = decodedBase64Bytes(req.a11y_tree_b64);
  if (a11yBytes === null) {
    sendError('schema_invalid', 'a11y_tree_b64 is not valid base64');
    return;
  }
  if (a11yBytes > BYTE_CAPS.A11Y_TREE_BYTES) {
    sendError('a11y_tree_too_big', `decoded ${a11yBytes} > cap ${BYTE_CAPS.A11Y_TREE_BYTES}`);
    return;
  }

  let screenshotBytes: number | null = null;
  if (req.screenshot_b64 !== undefined) {
    screenshotBytes = decodedBase64Bytes(req.screenshot_b64);
    if (screenshotBytes === null) {
      sendError('schema_invalid', 'screenshot_b64 is not valid base64');
      return;
    }
    if (screenshotBytes > BYTE_CAPS.SCREENSHOT_BYTES) {
      sendError('screenshot_too_big', `decoded ${screenshotBytes} > cap ${BYTE_CAPS.SCREENSHOT_BYTES}`);
      return;
    }
  }

  // Decode + redact + persist
  const captureId = (deps.newId ?? randomUUID)();
  const a11yDecoded = Buffer.from(req.a11y_tree_b64, 'base64');
  const redacted = redact(a11yDecoded.toString('utf8'));

  const a11yKey = `captures/${captureId}/a11y.json`;
  let screenshotKey: string | undefined;

  try {
    await deps.storage.put(a11yKey, Buffer.from(redacted.redacted, 'utf8'), 'application/json');
    if (req.screenshot_b64 !== undefined) {
      screenshotKey = `captures/${captureId}/screenshot.png`;
      await deps.storage.put(
        screenshotKey,
        Buffer.from(req.screenshot_b64, 'base64'),
        'image/png',
      );
    }
  } catch (e) {
    sendError('storage_failed', e instanceof Error ? e.message.slice(0, 200) : undefined);
    return;
  }

  const row: PageCaptureRow = {
    capture_id: captureId,
    status: req.status,
    a11y_object_key: a11yKey,
    screenshot_object_key: screenshotKey ?? null,
    banner_selectors_matched: req.banner_selectors_matched,
    overlays_unknown_present: req.overlays_unknown_present,
    blocked_reason: req.blocked_reason ?? null,
    host_count: req.host_count,
    breach_reason: req.breach_reason ?? null,
    redactor_v: REDACTOR_VERSION,
    created_at: (deps.now ?? (() => new Date().toISOString()))(),
    ...(req.study_id !== undefined && { study_id: req.study_id }),
    ...(req.url_hash !== undefined && { url_hash: req.url_hash }),
    ...(req.side !== undefined && { side: req.side }),
  };

  let pageCaptureId: number | undefined;
  try {
    const inserted = await deps.store.insert(row);
    // id=0 from inMemoryCaptureStore (smoke/tests); real bigint PK from pgCaptureStore.
    if (inserted.id > 0) pageCaptureId = inserted.id;
  } catch (e) {
    sendError('db_failed', e instanceof Error ? e.message.slice(0, 200) : undefined);
    return;
  }

  const ackOk: BrokerAck = {
    ok: true,
    capture_id: captureId,
    a11y_object_key: a11yKey,
    ...(screenshotKey !== undefined && { screenshot_object_key: screenshotKey }),
    ...(pageCaptureId !== undefined && { page_capture_id: pageCaptureId }),
  };
  sendAck(ackOk);
}
