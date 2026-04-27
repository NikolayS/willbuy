/**
 * log-dir-pin.test.ts — spec-pin for DEFAULT_LOG_DIR in packages/log/src/index.ts.
 *
 * DEFAULT_LOG_DIR='/var/log/willbuy' is the production log destination.
 * Changing it redirects log output in production without any code change
 * visible at the call site. The infra logrotate config (infra/observability/
 * logrotate.conf) also targets this path — a mismatch causes rotation to stop
 * working and disk to fill.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/index.js';

const { DEFAULT_LOG_DIR } = __test__;

describe('DEFAULT_LOG_DIR spec-pin (packages/log/src/index.ts)', () => {
  it('is "/var/log/willbuy"', () => {
    expect(DEFAULT_LOG_DIR).toBe('/var/log/willbuy');
  });
});
