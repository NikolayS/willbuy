/**
 * metrics/registry.ts — RED stub for issue #119.
 *
 * GREEN commit replaces this with a real Prometheus exposition registry.
 * For the RED commit, the symbols exist (so the test file type-checks) but
 * the implementation is intentionally empty/stub so tests fail.
 */

export interface RecordStudyStartedArgs {
  kind: 'single' | 'paired';
}

export function recordStudyStarted(_args: RecordStudyStartedArgs): void {
  // RED stub — replaced in GREEN.
}

export function resetMetricsForTesting(): void {
  // RED stub — replaced in GREEN.
}

export function renderExposition(): string {
  // RED stub — empty exposition, will not satisfy the tests' regex assertions.
  return '';
}
