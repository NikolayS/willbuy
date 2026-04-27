/**
 * cdpCommandsPin.test.ts — spec-pin for Chrome DevTools Protocol (CDP)
 * command name strings in apps/capture-worker/src/capture.ts (spec §2 #2).
 *
 * Two CDP commands are used to extract the page state:
 *
 *   'Accessibility.getFullAXTree'
 *     Returns the full accessibility tree (all AX nodes). The v0.1 capture
 *     relies on this for the a11y_tree payload sent to the broker. A typo
 *     or wrong command name causes cdp.send() to throw a CDP protocol error
 *     on every capture, failing all visits with status='error'.
 *
 *   'DOM.getDocument'
 *     Returns the root DOM node, used to count total DOM nodes against
 *     CAPTURE_CEILINGS.DOM_NODES (250_000). A wrong command name would
 *     mean DOM node counting always fails, all captures return dom_nodes
 *     breach, producing all-failed visits.
 *
 * These are plain string literals passed to cdp.send() — TypeScript does
 * not type-check CDP method names (they're typed as `string` in the CDP
 * protocol typings).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'capture.ts'), 'utf8');

describe("capture.ts CDP command names (spec §2 #2)", () => {
  it("uses 'Accessibility.getFullAXTree' to extract the a11y tree", () => {
    expect(src).toContain("'Accessibility.getFullAXTree'");
  });

  it("uses 'DOM.getDocument' to count DOM nodes", () => {
    expect(src).toContain("'DOM.getDocument'");
  });

  it("getFullAXTree returns 'nodes' property (destructured as { nodes })", () => {
    expect(src).toContain("{ nodes }");
  });

  it("DOM.getDocument uses depth: -1 and pierce: true for full traversal", () => {
    // depth: -1 = unlimited depth; pierce: true = cross shadow DOM boundaries.
    expect(src).toContain("depth: -1, pierce: true");
  });
});
