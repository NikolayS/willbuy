// Spec §4.1: this package is the ONLY call site for chat. Workers depend on
// `LLMProvider`; one wired backend ships in v0.1 (§2 #27).
//
// LocalCliProvider subprocess-shells out to a CLI binary configured via the
// WILLBUY_LLM_BIN env var (default 'claude' per issue #5). Each chat() call
// is a fresh execFile/spawn — no shared state, no session reuse — preserving
// the spec §2 #15 fresh-context guarantee at the lowest level. The logical
// request key is forwarded as WILLBUY_REQ_KEY in the subprocess env so a
// future provider can use it as Idempotency-Key (the v0.1 local CLI may
// ignore it; spec §5.15 says transport retries reuse the key, schema-repair
// generates a new one).
//
// Per spec §5.15 / §2 #15 the logical_request_key embeds a model component;
// LLMProvider exposes model() so callers (visitor-worker, the API server's
// spend ledger, the daily reconciliation job) can compute a key that
// matches the on-wire request. LocalCliProvider's model() honors
// WILLBUY_LLM_MODEL (default `local-cli/v1`) and forwards it to the
// subprocess as WILLBUY_LLM_MODEL.
//
// Issue #27 / spec §5.15 — transport retry + idempotency. chat() now wraps
// a single subprocess invocation in a transport-retry loop:
//   - transient_safe_retry (exit 130 SIGINT-coded / 137 SIGKILL-coded by an
//     external supervisor, NOT by us): retry with the SAME logicalRequestKey
//     up to 3 attempts, jittered backoff 0.5 s → 2 s → 8 s.
//   - non_transient (exit 1 with non-empty stderr suggesting bad input,
//     spawn ENOENT, other non-zero exits): no retry, status='error'.
//   - indeterminate (adapter-fired SIGKILL on timeout — the call may or may
//     not have reached the model side; spec §5.15 calls this `maybe_executed`
//     for an idempotency:false provider): no retry, status='indeterminate'.
//     The daily reconciliation job (Sprint 3) resolves these against
//     provider billing.
// transportAttempts in the result counts the actual on-wire attempts and is
// observability only — it does NOT contribute to the logical_request_key.

import { spawn } from 'node:child_process';

export interface LLMProviderCapabilities {
  // Per spec §2 #15 / §5.15 — does the provider honor Idempotency-Key?
  idempotency: boolean;
  // Spec §2 #33 — provider configured to not retain prompts.
  zero_retention: boolean;
  // Spec §2 #27 — supports JSON-mode / schema-constrained output.
  structured_output: boolean;
  // Spec §1 prompt-caching carve-out — can mark a static prefix cacheable.
  prompt_caching: boolean;
}

export interface LLMChatOptions {
  staticPrefix: string;
  dynamicTail: string;
  logicalRequestKey: string;
  maxOutputTokens: number;
}

export interface LLMChatResult {
  raw: string;
  transportAttempts: number;
  status: 'ok' | 'indeterminate' | 'error';
}

export interface LLMProvider {
  name(): string;
  // Spec §5.15 / §2 #15: logical_request_key embeds the `model` component.
  // The provider — not the caller — owns model identity (mirrors name()
  // and capabilities()), so callers can compute a key that matches the
  // on-wire request without coupling to provider config. Stable for the
  // lifetime of the process; bumped only via deploy-time env (e.g.
  // WILLBUY_LLM_MODEL) — never per-call.
  model(): string;
  capabilities(): LLMProviderCapabilities;
  chat(opts: LLMChatOptions): Promise<LLMChatResult>;
}

export const LOCAL_CLI_CAPABILITIES: LLMProviderCapabilities = {
  idempotency: false,
  zero_retention: false,
  structured_output: false,
  prompt_caching: false,
};

// Generic identifier per issue #5 / CLAUDE.md "Public repo discipline":
// the provider implementation MUST NOT name a specific vendor in src/
// identifiers, filenames, or logged messages. The CLI binary itself is
// configurable via WILLBUY_LLM_BIN; "local-cli" is the abstraction name.
export const LOCAL_CLI_PROVIDER_NAME = 'local-cli';

// Spec §5.15 / §2 #15 model component for logical_request_key. Generic
// per CLAUDE.md "no vendor name leaks"; deploy-time override via the
// WILLBUY_LLM_MODEL env var lets ops bump the identity (e.g. canary)
// without a code change while keeping the key stable per-process.
export const LOCAL_CLI_DEFAULT_MODEL = 'local-cli/v1';

// Spec §4.1 mentions a 120 s default subprocess timeout for the local CLI.
export const LOCAL_CLI_DEFAULT_TIMEOUT_MS = 120_000;

// Spec §5.15: up to 3 transport retries per logical request with jittered
// exponential backoff 0.5 s → 2 s → 8 s. The array is the wait BEFORE attempt
// N+1 (i.e. between attempt 1 and 2, 2 and 3); attempt 1 has no leading wait.
// We carry 3 entries even though the third is unused on the cap=3 path —
// keeps the schedule readable and matches the spec text 1:1.
export const LOCAL_CLI_DEFAULT_BACKOFF_MS: readonly number[] = [500, 2000, 8000];

// Spec §5.15: cap at 3 transport attempts.
export const LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS = 3;

export interface LocalCliProviderOptions {
  // Test/override hook: pass argv directly. When undefined, the provider
  // resolves the binary from the WILLBUY_LLM_BIN env var (default 'claude'
  // per issue #5; the value MUST stay generic and configurable).
  argv?: readonly string[];
  // Extra env vars merged into the subprocess env; logicalRequestKey is
  // injected as WILLBUY_REQ_KEY by chat() regardless of what's passed here.
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  // Transport-retry backoff schedule (issue #27 / spec §5.15). Tests pass
  // [0,0,0] for fast runs; production uses LOCAL_CLI_DEFAULT_BACKOFF_MS.
  // Length must be ≥ LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS - 1 (the wait before
  // each retry); excess entries are ignored.
  backoffMs?: readonly number[];
  // Jitter scale [0,1]. Applied as `wait * (1 + jitter * random())`. Default
  // 0.2 (i.e. up to +20%). Tests pass 0 for determinism. Spec §5.15 says
  // "jittered exponential backoff" without pinning a scale; +20% is small
  // enough to not stretch the 8 s tail meaningfully and large enough to
  // de-synchronize concurrent transient failures across visitors.
  jitter?: number;
  // Test seam — clock for the backoff sleep. Defaults to setTimeout. Tests
  // can pass an immediate-resolve impl to skip waits without zero-wait races.
  sleepFn?: (ms: number) => Promise<void>;
}

export class LocalCliProvider implements LLMProvider {
  private readonly options: LocalCliProviderOptions;

  constructor(options: LocalCliProviderOptions = {}) {
    this.options = options;
  }
  name(): string {
    return LOCAL_CLI_PROVIDER_NAME;
  }
  // Spec §5.15 / §2 #15: model identity contributes to logical_request_key.
  // Resolved fresh on every call (no cache) so a deploy-time env-var bump
  // takes effect without restarting the process — at the cost of a per-call
  // env lookup, which is negligible vs. the subprocess spawn cost.
  model(): string {
    const envModel = process.env.WILLBUY_LLM_MODEL;
    if (envModel && envModel.trim().length > 0) {
      return envModel.trim();
    }
    return LOCAL_CLI_DEFAULT_MODEL;
  }
  capabilities(): LLMProviderCapabilities {
    return LOCAL_CLI_CAPABILITIES;
  }
  async chat(opts: LLMChatOptions): Promise<LLMChatResult> {
    const argv = this.resolveArgv();
    if (argv.length === 0) {
      return { raw: '', transportAttempts: 1, status: 'error' };
    }

    const [cmd, ...args] = argv;
    const timeoutMs = this.options.timeoutMs ?? LOCAL_CLI_DEFAULT_TIMEOUT_MS;
    const stdinPayload = `${opts.staticPrefix}\n${opts.dynamicTail}`;
    const env = {
      ...process.env,
      ...(this.options.env ?? {}),
      WILLBUY_REQ_KEY: opts.logicalRequestKey,
      // Spec §5.15: the on-wire request and the logical_request_key share
      // the same model identity. Forwarded so a future provider impl can
      // pin the model on the subprocess side too.
      WILLBUY_LLM_MODEL: this.model(),
    };

    const backoff =
      this.options.backoffMs ?? LOCAL_CLI_DEFAULT_BACKOFF_MS;
    const jitter = this.options.jitter ?? 0.2;
    const sleep = this.options.sleepFn ?? defaultSleep;

    // Spec §5.15: same logicalRequestKey across all transport attempts.
    // The provider-side Idempotency-Key (when capabilities.idempotency is
    // true) MUST stay byte-identical so a future HTTP backend can dedupe.
    let transportAttempts = 0;

    for (let i = 0; i < LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS; i += 1) {
      transportAttempts += 1;
      const outcome = await runOnceClassified({
        cmd: cmd!,
        args,
        env,
        stdin: stdinPayload,
        timeoutMs,
      });

      if (outcome.kind === 'ok') {
        return {
          raw: outcome.raw,
          transportAttempts,
          status: 'ok',
        };
      }
      if (outcome.kind === 'transient_safe_retry') {
        if (i + 1 < LOCAL_CLI_MAX_TRANSPORT_ATTEMPTS) {
          const baseWait = backoff[i] ?? 0;
          // jitter ∈ [0, 1]; final wait ∈ [baseWait, baseWait * (1 + jitter)].
          // Math.random() is not exercised in CI (tests pass sleepFn that
          // returns immediately). The jitter path is correct-by-inspection:
          // random() ∈ [0,1) so waitMs ∈ [baseWait, baseWait*(1+jitter)).
          const waitMs = baseWait * (1 + jitter * Math.random());
          await sleep(waitMs);
        }
        continue;
      }
      // Spec §5.15: idempotency:false → timeout|connection_reset|unknown_status
      // does not transport-retry; classify indeterminate and let the
      // reconciliation job resolve. Idempotent providers (a future HTTP
      // backend with capabilities.idempotency=true) MAY transport-retry
      // these classes too — out of scope for this v0.1 LocalCliProvider.
      if (outcome.kind === 'indeterminate') {
        return {
          raw: '',
          transportAttempts,
          status: 'indeterminate',
        };
      }
      // non_transient: bad input / spawn failure / unclassified non-zero —
      // no retry, surface error immediately.
      return {
        raw: '',
        transportAttempts,
        status: 'error',
      };
    }

    // Loop ended → all 3 attempts were transient_safe_retry; cap reached.
    // lastOutcome is always 'transient_safe_retry' at this point; no
    // actionable information to surface beyond status='error'.
    return {
      raw: '',
      transportAttempts,
      status: 'error',
    };
  }

  private resolveArgv(): string[] {
    if (this.options.argv && this.options.argv.length > 0) {
      return [...this.options.argv];
    }
    const envBin = process.env.WILLBUY_LLM_BIN;
    if (envBin && envBin.trim().length > 0) {
      // Naive split is fine for v0.1: WILLBUY_LLM_BIN is set by ops, not
      // by user input, and we explicitly do NOT support shell metachars.
      return envBin.trim().split(/\s+/);
    }
    return ['claude'];
  }
}

interface RunOnceOpts {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin: string;
  timeoutMs: number;
}

// Single-attempt outcome classification per spec §5.15 / issue #27.
//   - 'ok'                    — exit 0, raw stdout payload returned.
//   - 'transient_safe_retry'  — supervisor-style signal exits (130 SIGINT, 137
//     SIGKILL by an EXTERNAL killer, NOT us). Effectively the call did not
//     reach the model side; safe to retry with the same logical key.
//   - 'indeterminate'         — adapter-fired SIGKILL on our timeout, or
//     connection-reset / unknown_status. The call MAY have reached the
//     model; for an idempotency:false provider we don't retry — daily
//     reconciliation resolves.
//   - 'non_transient'         — exit 1 with non-empty stderr (bad input),
//     spawn ENOENT, or any other non-zero code we have no specific
//     handling for. Conservative default: do not retry.
type AttemptOutcome =
  | { kind: 'ok'; raw: string }
  | { kind: 'transient_safe_retry'; reason: string }
  | { kind: 'indeterminate'; reason: string }
  | { kind: 'non_transient'; reason: string };

function runOnceClassified(opts: RunOnceOpts): Promise<AttemptOutcome> {
  return new Promise((resolveP) => {
    const child = spawn(opts.cmd, opts.args, {
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    // Distinguish OUR timer-fired SIGKILL from an EXTERNAL signal kill.
    // close() reports `signal: 'SIGKILL'` in both cases, so we need this
    // flag to map adapter-timeout → indeterminate (per spec §5.15 the
    // provider may have processed the request; pessimistic debit applies).
    let timedOutByAdapter = false;
    let settled = false;
    const settle = (outcome: AttemptOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP(outcome);
    };

    const timer: NodeJS.Timeout = setTimeout(() => {
      // SIGKILL — the spec wants pessimistic-on-timeout behavior; a polite
      // SIGTERM the child can ignore would defeat the wall-clock guarantee.
      timedOutByAdapter = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
      // Don't settle yet — let the close handler observe the kill and
      // emit the final classification. close fires reliably after kill.
    }, opts.timeoutMs);

    child.on('error', () => {
      // ENOENT (binary not found) and similar spawn failures — non-transient.
      settle({ kind: 'non_transient', reason: 'spawn_error' });
    });

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stdout.on('error', () => {
      // Stream errors fold into the same error path; the close handler will
      // observe the non-zero exit / signal.
    });
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    child.stderr.on('error', () => {});

    child.on('close', (code, signal) => {
      // Race note: if the child exits cleanly (code=0) in the same event-loop
      // turn that our timer fires, Node.js queues both events; the first one
      // to reach settle() wins (settled flag prevents double-resolve).  If
      // close arrives first we return 'ok'; if the timer callback runs first
      // it sets timedOutByAdapter=true and we classify 'indeterminate'. Either
      // outcome is valid; the race is benign because settle is idempotent.
      if (timedOutByAdapter) {
        // Spec §5.15 — `maybe_executed` outcome class. For idempotency:false
        // (LocalCliProvider) the chat() loop will classify indeterminate and
        // skip retry.
        settle({ kind: 'indeterminate', reason: 'adapter_timeout' });
        return;
      }
      if (code === 0) {
        const raw = Buffer.concat(stdoutChunks).toString('utf8');
        settle({ kind: 'ok', raw });
        return;
      }
      // Externally signal-killed (e.g. supervisor OOM-killer, SIGINT during
      // shutdown). Not us — the call effectively didn't reach the provider,
      // so it's safe to retry under the same logical key.
      if (signal === 'SIGKILL' || signal === 'SIGINT' || signal === 'SIGTERM') {
        settle({
          kind: 'transient_safe_retry',
          reason: `signal_${signal}`,
        });
        return;
      }
      // Issue #27 spec: exit codes 130 (SIGINT-coded) and 137 (SIGKILL-coded)
      // are the conventional exit-code form when a process self-traps and
      // re-exits with `128 + signo`. Treat as transient_safe_retry — same
      // semantics as the signal case above.
      if (code === 130 || code === 137) {
        settle({
          kind: 'transient_safe_retry',
          reason: `exit_${code}`,
        });
        return;
      }
      // Issue #27 spec: exit 1 with non-empty stderr suggesting bad input.
      // No retry — the input itself is the problem; retrying would just
      // re-fail. Other non-zero codes we don't recognize fall through to
      // the same conservative non-retry branch.
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');
      void stderrText;
      settle({
        kind: 'non_transient',
        reason: `exit_${code ?? 'null'}`,
      });
    });

    child.stdin.on('error', () => {
      // EPIPE on a fast-failing child (e.g. exits before reading stdin).
      // Close handler will produce the final classification.
    });
    child.stdin.end(opts.stdin);
  });
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
