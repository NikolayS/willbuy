import type { CaptureOpts, CaptureResult } from './types.js';

/**
 * Capture a URL into a serialized accessibility tree (§2 #2).
 *
 * Implementation lands in the next commit (TDD red→green per CLAUDE.md).
 */
export async function captureUrl(_url: string, _opts?: CaptureOpts): Promise<CaptureResult> {
  throw new Error('NotImplemented: captureUrl');
}
