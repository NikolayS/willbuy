// Test-only LLMProvider double. Records every chat() call (so tests can
// assert on dynamicTail / staticPrefix / logicalRequestKey content) and
// returns a scripted sequence of results — the orchestrator under test
// then drives schema-repair + transport-error branches off those returns.

import type {
  LLMChatOptions,
  LLMChatResult,
  LLMProvider,
  LLMProviderCapabilities,
} from '@willbuy/llm-adapter';

export interface RecordedChat {
  staticPrefix: string;
  dynamicTail: string;
  logicalRequestKey: string;
  maxOutputTokens: number;
}

export interface MockProviderOptions {
  name?: string;
  capabilities?: LLMProviderCapabilities;
  responses: ReadonlyArray<LLMChatResult>;
}

export class MockProvider implements LLMProvider {
  readonly calls: RecordedChat[] = [];
  private readonly responses: ReadonlyArray<LLMChatResult>;
  private readonly providerName: string;
  private readonly caps: LLMProviderCapabilities;

  constructor(opts: MockProviderOptions) {
    this.responses = opts.responses;
    this.providerName = opts.name ?? 'mock-provider';
    this.caps = opts.capabilities ?? {
      idempotency: false,
      zero_retention: false,
      structured_output: false,
      prompt_caching: false,
    };
  }

  name(): string {
    return this.providerName;
  }
  capabilities(): LLMProviderCapabilities {
    return this.caps;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async chat(opts: LLMChatOptions): Promise<LLMChatResult> {
    this.calls.push({
      staticPrefix: opts.staticPrefix,
      dynamicTail: opts.dynamicTail,
      logicalRequestKey: opts.logicalRequestKey,
      maxOutputTokens: opts.maxOutputTokens,
    });
    const idx = this.calls.length - 1;
    const r = this.responses[idx];
    if (r === undefined) {
      throw new Error(
        `MockProvider exhausted: chat() call #${idx + 1} but only ${this.responses.length} scripted responses`,
      );
    }
    return r;
  }
}
