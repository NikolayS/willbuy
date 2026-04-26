/**
 * errors.ts — typed errors raised by the @willbuy/log redactor.
 *
 * Spec §5.12 / issue #118 TDD #4: a single string field exceeding
 * MAX_FIELD_BYTES is treated as a smell of an accidental payload-leak —
 * captured page bytes, an LLM response, a provider blob, or similar — that
 * was misnamed by the caller and slipped past the field-name allow/deny
 * list. Rather than silently truncating with a size marker, the redactor
 * THROWS LogPayloadOversizeError so the upstream pino formatter can swallow
 * the throw, emit a structured alert event (`log_payload_oversize`), and
 * keep the host running. Loud failure on oversize is the design.
 */

/** Single-string-field byte ceiling above which the redactor throws. */
export const MAX_FIELD_BYTES = 8192;

export class LogPayloadOversizeError extends Error {
  /** Field name carrying the oversized string. */
  public readonly field: string;
  /** Byte length of the offending value (UTF-8). */
  public readonly size: number;

  constructor(field: string, size: number) {
    super(
      `@willbuy/log: oversize string in field "${field}" (${size} bytes > ${MAX_FIELD_BYTES} cap)`,
    );
    this.name = 'LogPayloadOversizeError';
    this.field = field;
    this.size = size;
  }
}
