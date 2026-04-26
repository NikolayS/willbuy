import { z } from 'zod';

/**
 * Capture Broker request schema — spec §5.13 v0.1.
 *
 * One typed message per capture, sent over the broker Unix socket
 * (`/run/willbuy/broker.sock`, mode 0660). Shape and byte caps are
 * authoritative; the broker enforces both as defense-in-depth over the
 * worker-side ceilings (§2 #6) — by design, since a compromised worker
 * could lie about its own caps.
 *
 * Note: the schema enforces SHAPE here. Decoded-byte caps for
 * `a11y_tree_b64` and `screenshot_b64` are enforced separately in
 * `byteCaps.ts` — zod cannot cheaply assert decoded base64 length, and
 * we want a structured rejection reason ('a11y_tree_too_big' vs
 * 'screenshot_too_big') rather than a generic ZodError.
 */
export const CaptureRequest = z
  .object({
    status: z.enum(['ok', 'blocked', 'error']),
    a11y_tree_b64: z.string(),
    // Optional: only when study.screenshots_enabled AND after the OCR
    // scrub (Sprint 3). For v0.1 the worker leaves it absent.
    // N5: empty string is rejected — a screenshot_b64 present must encode
    // at least 1 byte of actual image data.
    screenshot_b64: z.string().min(1).optional(),
    banner_selectors_matched: z.array(z.string()),
    overlays_unknown_present: z.boolean(),
    blocked_reason: z.string().optional(),
    host_count: z.number().int().min(0),
    breach_reason: z.string().optional(),
    // study_id + url_hash: sent by capture-worker in production so the
    // broker can write the page_captures DB row. Optional so that the
    // --smoke probe (bin.ts runSmoke) and unit tests that use in-memory
    // doubles remain free of live DB requirements.
    study_id: z.number().int().positive().optional(),
    url_hash: z.string().optional(),
  })
  .strict();

export type CaptureRequest = z.infer<typeof CaptureRequest>;

/**
 * Broker response. Single JSON message; the broker writes it then closes
 * the connection (single-shot per spec §5.13).
 */
export type BrokerAck =
  | {
      ok: true;
      capture_id: string;
      a11y_object_key: string;
      screenshot_object_key?: string;
      /** Bigint PK of the page_captures row; present when pgCaptureStore is wired. */
      page_capture_id?: number;
    }
  | {
      ok: false;
      error: BrokerErrorCode;
      detail?: string;
    };

export type BrokerErrorCode =
  | 'malformed_json'
  | 'schema_invalid'
  | 'a11y_tree_too_big'
  | 'screenshot_too_big'
  | 'message_too_big'
  | 'duplicate_message'
  | 'storage_failed'
  | 'db_failed'
  | 'internal';
