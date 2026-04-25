// Spec §4.1: this package is the ONLY call site for chat. Workers depend on
// `LLMProvider`; one wired backend ships in v0.1 (§2 #27).
//
// Stub skeleton — tests in test/ drive the real implementation in red→green
// commit pairs per CLAUDE.md TDD discipline.

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
  // Stored but unused until green commit lands.
  private readonly _options: LocalCliProviderOptions;

  constructor(options: LocalCliProviderOptions = {}) {
    this._options = options;
  }
  name(): string {
    return LOCAL_CLI_PROVIDER_NAME;
  }
  capabilities(): LLMProviderCapabilities {
    return LOCAL_CLI_CAPABILITIES;
  }
  chat(_opts: LLMChatOptions): Promise<LLMChatResult> {
    void this._options;
    throw new Error('not implemented');
  }
}
