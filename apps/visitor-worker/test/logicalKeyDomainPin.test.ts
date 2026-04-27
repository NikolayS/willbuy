/**
 * logicalKeyDomainPin.test.ts — spec-pin for the 'visit' domain discriminator
 * in computeLogicalRequestKey (visitor.ts, spec §5.15 / §2 #15).
 *
 * The logical_request_key is:
 *   sha256(visitId | '|' | providerName | '|' | modelName | '|' | 'visit' | '|' | repairGeneration)
 *
 * The 'visit' segment is the kind discriminator that prevents key collisions
 * between visit, embedding, cluster_label, and probe kinds (all of which use
 * sha256-based idempotency keys that include a kind tag).
 *
 * Renaming 'visit' to any other string (e.g. 'llm-visit') invalidates all
 * in-flight idempotency keys at deploy time — any visit in the retry window
 * would compute a different key and issue a duplicate provider call.
 *
 * The pipe '|' separators are also part of the serialization contract;
 * this test pins them along with the discriminator.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'visitor.ts'), 'utf8');

describe("computeLogicalRequestKey domain discriminator (spec §5.15)", () => {
  it("uses 'visit' as the kind domain segment in the hash", () => {
    expect(src).toContain("h.update('visit')");
  });

  it("uses '|' as the segment separator", () => {
    expect(src).toContain("h.update('|')");
  });

  it("the 'visit' segment appears after providerName and modelName updates", () => {
    const providerIdx = src.indexOf('h.update(providerName)');
    const modelIdx = src.indexOf('h.update(modelName)');
    const visitIdx = src.indexOf("h.update('visit')");
    expect(providerIdx).toBeGreaterThan(-1);
    expect(modelIdx).toBeGreaterThan(providerIdx);
    expect(visitIdx).toBeGreaterThan(modelIdx);
  });

  it("uses sha256 as the hash algorithm (§5.15 key format)", () => {
    expect(src).toContain("createHash('sha256')");
  });
});
