// Lint fixture: clean module — no reserved continuation identifiers,
// no forbidden patterns, no banned literals. The willbuy/no-reserved-llm-
// identifiers rule MUST accept this file. (issue #5 acceptance #6)

export interface CleanShape {
  visit_id: string;
  logical_request_key: string;
  transport_attempts: number;
}

export const cleanPayload: CleanShape = {
  visit_id: 'v1',
  logical_request_key: 'lk-1',
  transport_attempts: 1,
};

export function score(input: CleanShape): number {
  const { transport_attempts } = input;
  return transport_attempts;
}
