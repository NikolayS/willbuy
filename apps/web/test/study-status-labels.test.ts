/**
 * study-status-labels.test.ts — spec-pins for STATUS_LABELS and TERMINAL.
 *
 * STATUS_LABELS maps all 6 StudyStatus values to human-readable strings.
 * If a 7th status is added to STUDY_STATUSES (api-client.ts) but not to
 * STATUS_LABELS, the UI silently renders 'undefined' on that status.
 *
 * TERMINAL = ['ready', 'failed'] — polling stops when status is in this set.
 * Removing 'ready' would cause the status page to keep polling forever after
 * a study completes.
 *
 * POLL_INTERVAL_MS = 5_000 — the study status page polls every 5 seconds.
 * Changing this without updating the study-poll test could silently break SLO.
 */

import { describe, expect, it } from 'vitest';
import { STUDY_STATUSES } from '../lib/api-client';
import { __test__ } from '../app/dashboard/studies/[id]/page';

const { STATUS_LABELS, TERMINAL, POLL_INTERVAL_MS } = __test__;

describe('STATUS_LABELS spec-pin (StudyStatus display strings)', () => {
  it('has a label for every STUDY_STATUSES entry', () => {
    for (const status of STUDY_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('has exactly 6 entries (one per StudyStatus)', () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(6);
  });

  it('"ready" → "Ready"', () => {
    expect(STATUS_LABELS['ready']).toBe('Ready');
  });

  it('"failed" → "Failed"', () => {
    expect(STATUS_LABELS['failed']).toBe('Failed');
  });
});

describe('TERMINAL spec-pin (polling stop condition)', () => {
  it('contains "ready" — polling stops when study completes', () => {
    expect(TERMINAL).toContain('ready');
  });

  it('contains "failed" — polling stops when study fails', () => {
    expect(TERMINAL).toContain('failed');
  });

  it('has exactly 2 terminal statuses', () => {
    expect(TERMINAL).toHaveLength(2);
  });
});

describe('POLL_INTERVAL_MS spec-pin', () => {
  it('is 5_000 (5-second polling interval)', () => {
    expect(POLL_INTERVAL_MS).toBe(5_000);
  });
});
