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

export class LocalCliProvider implements LLMProvider {
  name(): string {
    throw new Error('not implemented');
  }
  capabilities(): LLMProviderCapabilities {
    throw new Error('not implemented');
  }
  chat(_opts: LLMChatOptions): Promise<LLMChatResult> {
    throw new Error('not implemented');
  }
}
