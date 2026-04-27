// runtime.ts — capture-worker runtime dispatcher (issue #116, spec §5.13).
//
// Selects between the v0.1 container-in-netns transport (current default)
// and the v0.2 Firecracker microVM transport (stubbed seam in this PR;
// jailer + vsock land in #117). The two paths share the same input shape
// (RunWithNetnsOpts → opts here) and the same return contract for the
// netns path. The firecracker path throws RuntimeNotImplementedError
// until #117 wires it up — this commit is the dispatch surface only.
//
// Spec §5.13:
//   v0.1 (container transport): per-container netns + iptables; broker
//     reaches host via /run/willbuy/broker.sock (Unix socket).
//   v0.2 (microVM upgrade): transport changes to vsock (cid=host, port=9000)
//     with iptables on the microVM tap device. Request/response schema,
//     broker validation, byte caps, retention all stay identical — the
//     broker contract is transport-agnostic by design, so the v0.2 cutover
//     is host-side + base-image only.
//
// Why a typed seam now (issue #116):
//   - The Firecracker host bootstrap (#115) and base image (#114) are landing
//     this sprint; #117 will wire the actual VM launch + vsock.
//   - Until then, running with WILLBUY_CAPTURE_RUNTIME=firecracker must FAIL
//     LOUDLY with a typed error (not silently fall through to netns) so that
//     ops can verify the seam in staging without thinking they accidentally
//     got the legacy path.
//   - The selector validates at process-start (not at first request), so a
//     misconfigured deploy fails the unit/health-check phase, not the first
//     real visit.
//
// Default behavior preservation:
//   selectRuntime(undefined) === 'netns'
//   selectRuntime('') === 'netns'
//   selectRuntime('netns') === 'netns'
//   runCapture(opts) with no second arg → netns path → identical to
//     runWithNetns(opts) (this is the regression guard in runtime.test.ts).

import {
  runWithNetns,
  type RunWithNetnsOpts,
  type RunWithNetnsResult,
} from './run-with-netns.js';

/**
 * The set of supported capture runtimes.
 *
 * - 'netns'      : v0.1 — container in a hardened Linux network namespace,
 *                  Unix-socket broker. This is the current production path.
 * - 'firecracker': v0.2 — microVM with vsock-broker. Stubbed in #116;
 *                  implementation lands in #117.
 */
export type CaptureRuntime = 'netns' | 'firecracker';

const SUPPORTED_RUNTIMES: readonly CaptureRuntime[] = ['netns', 'firecracker'];

/**
 * Thrown at startup when WILLBUY_CAPTURE_RUNTIME is set to a value that is
 * not in the supported set. Throwing here (not on first request) keeps a
 * misconfigured process from polling the queue and producing one
 * 'indeterminate' visit per misconfig before crashing.
 */
export class RuntimeConfigError extends Error {
  constructor(
    message: string,
    public readonly value: string,
  ) {
    super(message);
    this.name = 'RuntimeConfigError';
  }
}

/**
 * Thrown by a runtime path that is not yet wired (currently: 'firecracker').
 * Distinct from RuntimeConfigError because the value IS supported by the
 * type system — the seam exists but the implementation is deferred.
 *
 * Tests grep on `name === 'RuntimeNotImplementedError'` so callers in #117
 * can land the actual impl by deleting the throw, without renaming.
 */
export class RuntimeNotImplementedError extends Error {
  constructor(
    public readonly runtime: CaptureRuntime,
    message?: string,
  ) {
    super(
      message ??
        `capture runtime '${runtime}' is not yet implemented; expected to land in issue #117 (Firecracker jailer + vsock)`,
    );
    this.name = 'RuntimeNotImplementedError';
  }
}

/**
 * Validate a WILLBUY_CAPTURE_RUNTIME env value at process-start.
 *
 * @param value Raw env-var contents. `undefined` and `''` mean "unset" and
 *              return the default ('netns').
 * @returns The selected, type-narrowed CaptureRuntime.
 * @throws RuntimeConfigError when `value` is set but not in the supported
 *         set. The thrown error carries the offending value so the startup
 *         banner can log it without re-reading process.env.
 *
 * Case-sensitivity: matches are exact. `'NETNS'`, `'FireCracker'`, etc.
 * throw — typos in deploy manifests should fail loudly, not be silently
 * normalized.
 */
export function selectRuntime(value: string | undefined): CaptureRuntime {
  if (value === undefined || value === '') return 'netns';
  if ((SUPPORTED_RUNTIMES as readonly string[]).includes(value)) {
    return value as CaptureRuntime;
  }
  throw new RuntimeConfigError(
    `WILLBUY_CAPTURE_RUNTIME='${value}' is not supported. ` +
      `Expected one of: ${SUPPORTED_RUNTIMES.join(', ')} ` +
      `(unset defaults to 'netns').`,
    value,
  );
}

/**
 * Read WILLBUY_CAPTURE_RUNTIME from process.env and validate. Convenience
 * wrapper for the production entrypoint; tests prefer the pure
 * `selectRuntime(value)` form.
 */
export function selectRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CaptureRuntime {
  return selectRuntime(env['WILLBUY_CAPTURE_RUNTIME']);
}

/**
 * Dispatch a capture to the selected runtime.
 *
 * - 'netns'       → delegates to `runWithNetns(opts)` verbatim. All public
 *                   types and error semantics are preserved.
 * - 'firecracker' → throws RuntimeNotImplementedError. Issue #117 will
 *                   replace the throw with `runWithFirecracker(opts)`.
 *
 * @param runtime Optional override. When omitted, defaults to 'netns' so
 *                callers that haven't migrated to the dispatcher get
 *                pre-#116 behavior unchanged.
 */
export async function runCapture(
  opts: RunWithNetnsOpts,
  runtime: CaptureRuntime = 'netns',
): Promise<RunWithNetnsResult> {
  switch (runtime) {
    case 'netns':
      return runWithNetns(opts);
    case 'firecracker':
      // Stub seam — #117 lands the real impl. We accept the opts arg
      // (instead of e.g. throwing before evaluating it) so a future change
      // that drops the throw doesn't need a signature edit.
      void opts;
      throw new RuntimeNotImplementedError('firecracker');
    default: {
      // exhaustiveness check — if a future PR adds a new variant to
      // CaptureRuntime without updating this switch, the compiler errors.
      const _exhaustive: never = runtime;
      throw new RuntimeConfigError(
        `unhandled capture runtime: ${String(_exhaustive)}`,
        String(runtime),
      );
    }
  }
}

// Re-export the underlying types so callers can `import { runCapture,
// type RunWithNetnsOpts } from './runtime.js'` without reaching into
// run-with-netns.ts directly.
export type { RunWithNetnsOpts, RunWithNetnsResult };
