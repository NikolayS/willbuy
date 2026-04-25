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

export interface LocalCliProviderOptions {
  // Test/override hook: pass argv directly. When undefined, the provider
  // resolves the binary from the WILLBUY_LLM_BIN env var (default 'claude'
  // per issue #5; the value MUST stay generic and configurable).
  argv?: readonly string[];
  // Extra env vars merged into the subprocess env; logicalRequestKey is
  // injected as WILLBUY_REQ_KEY by chat() regardless of what's passed here.
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
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

    return await runOnce({
      cmd: cmd!,
      args,
      env: {
        ...process.env,
        ...(this.options.env ?? {}),
        WILLBUY_REQ_KEY: opts.logicalRequestKey,
        // Spec §5.15: the on-wire request and the logical_request_key share
        // the same model identity. Forwarded so a future provider impl can
        // pin the model on the subprocess side too.
        WILLBUY_LLM_MODEL: this.model(),
      },
      stdin: stdinPayload,
      timeoutMs,
    });
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

function runOnce(opts: RunOnceOpts): Promise<LLMChatResult> {
  return new Promise((resolveP) => {
    const child = spawn(opts.cmd, opts.args, {
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    let settled = false;
    const settle = (result: LLMChatResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP(result);
    };

    const timer: NodeJS.Timeout = setTimeout(() => {
      // SIGKILL — the spec wants pessimistic-on-timeout behavior; a polite
      // SIGTERM the child can ignore would defeat the wall-clock guarantee.
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
      settle({ raw: '', transportAttempts: 1, status: 'error' });
    }, opts.timeoutMs);

    child.on('error', () => {
      // ENOENT (binary not found) and similar spawn failures.
      settle({ raw: '', transportAttempts: 1, status: 'error' });
    });

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stdout.on('error', () => {
      // Stream errors fold into the same error path; the close handler will
      // observe the non-zero exit / signal.
    });
    child.stderr.on('data', () => {
      // Captured but intentionally not surfaced — keep logged messages
      // generic per CLAUDE.md "no vendor name leaks". Future: stream into
      // structured-log middleware behind an injected sink.
    });
    child.stderr.on('error', () => {});

    child.on('close', (code, signal) => {
      const raw = Buffer.concat(stdoutChunks).toString('utf8');
      if (code === 0) {
        settle({ raw, transportAttempts: 1, status: 'ok' });
      } else {
        // Killed by timeout (SIGKILL) OR non-zero exit → error w/ empty raw.
        void signal;
        settle({ raw: '', transportAttempts: 1, status: 'error' });
      }
    });

    child.stdin.on('error', () => {
      // EPIPE on a fast-failing child (e.g. exits before reading stdin).
      // Close handler will produce the final error result.
    });
    child.stdin.end(opts.stdin);
  });
}
