import { chromium, type Browser, type BrowserContext } from 'playwright';
import { LAUNCH_FLAGS } from './launchFlags.js';
import {
  CAPTURE_CEILINGS,
  type A11yNode,
  type BreachReason,
  type CaptureOpts,
  type CaptureResult,
} from './types.js';

/**
 * captureUrl — spec §2 #2 + §2 #6.
 *
 * Launches a Chromium browser via Playwright in the calling process
 * (the hardened-container layering is enforced by the Dockerfile + the
 * deploy-side network namespace; see PR description for what's deferred
 * to Sprint 2). Navigates to `url`, waits for `networkidle` plus a
 * 2-second tail for late-loading content, extracts the full
 * accessibility tree via CDP `Accessibility.getFullAXTree`, and
 * serializes it into a stable {role, name, …, children[]} hierarchy.
 *
 * Resource ceilings (§2 #6):
 *  - wall-clock: hard timer wraps the entire capture
 *  - host_count: per-request listener counts distinct hosts
 *  - DOM nodes / total bytes / a11y-tree bytes: post-extraction checks
 *
 * On any breach we abort cleanly and return `status: 'error'` with
 * `breach_reason`. On any unexpected error (navigation failure,
 * Chromium crash, etc.) we return `status: 'blocked'` with a short
 * blocked_reason. The broker (§5.13) will persist whatever we return.
 */
export async function captureUrl(url: string, opts?: CaptureOpts): Promise<CaptureResult> {
  const wallClockMs = opts?.wallClockMs ?? CAPTURE_CEILINGS.WALL_CLOCK_MS;
  const hostBudget = opts?.hostCountBudget ?? CAPTURE_CEILINGS.HOST_COUNT;
  const totalBytesBudget = opts?.totalBytesBudget ?? CAPTURE_CEILINGS.TOTAL_BYTES;
  const a11yTreeBytesBudget = opts?.a11yTreeBytesBudget ?? CAPTURE_CEILINGS.A11Y_TREE_BYTES;
  const domNodesBudget = opts?.domNodesBudget ?? CAPTURE_CEILINGS.DOM_NODES;
  const hostExtractor = opts?.hostExtractor ?? defaultHostExtractor;

  const hosts = new Set<string>();
  let totalBytes = 0;
  let breach: BreachReason | undefined;

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  // Wall-clock guard: a single timer that flips `breach` and force-closes
  // the browser. Closing mid-navigation makes Playwright's awaited
  // promises reject; we catch + map to the breach.
  const wallTimer = new WallClockTimer(wallClockMs);

  try {
    browser = await chromium.launch({
      args: [...LAUNCH_FLAGS],
      // chromiumSandbox stays at its default (true). Spec §2 #2.
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      // We never need permissions for a capture (§2 #7).
      permissions: [],
      // Some sites refuse plain Playwright UAs; keep neutral.
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 willbuy-capture/0.1',
    });

    const page = await context.newPage();

    // Host-count listener — counts distinct hosts per the §2 #5 budget.
    // Aborts immediately when the budget is exceeded so we don't waste
    // wall-clock continuing to download.
    page.on('request', (req) => {
      const host = hostExtractor(req.url());
      if (host && !hosts.has(host)) {
        hosts.add(host);
        if (hosts.size > hostBudget) {
          breach = 'host_count';
          // Best-effort: closing the context aborts in-flight ops.
          void context?.close().catch(() => {});
        }
      }
    });

    // Total-bytes listener — accumulates response body sizes (spec §2 #6).
    // Aborts as soon as the running total crosses the ceiling so we don't
    // buffer an unbounded response into memory before we can check.
    page.on('response', (resp) => {
      const contentLength = resp.headers()['content-length'];
      if (contentLength) {
        totalBytes += parseInt(contentLength, 10);
        if (totalBytes > totalBytesBudget) {
          breach = 'total_bytes';
          void context?.close().catch(() => {});
        }
      }
    });

    // Race the actual capture against the wall-clock timer. We don't
    // use Playwright's per-call timeout because we want a SINGLE budget
    // covering nav + idle wait + tree dump.
    const captureTask = (async (): Promise<CaptureResult> => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: wallClockMs });
      // §2 #2: "+ 2 seconds for late-loading content". If the wall-clock
      // budget is below that, skip the tail wait entirely.
      const tail = Math.min(2_000, Math.max(0, wallClockMs - 1_000));
      if (tail > 0) await page.waitForTimeout(tail);

      const cdp = await context!.newCDPSession(page);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const tree = serializeAxTree(nodes as AxNode[]);

      const treeBytes = Buffer.byteLength(JSON.stringify(tree), 'utf8');
      if (treeBytes > a11yTreeBytesBudget) {
        return errorResult(url, hosts.size, 'a11y_tree_bytes');
      }

      // DOM node count via CDP (cheap; runs on the renderer side).
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const domNodes = countDomNodes(root as DomNode);
      if (domNodes > domNodesBudget) {
        return errorResult(url, hosts.size, 'dom_nodes');
      }

      return {
        status: 'ok',
        url,
        a11y_tree: tree,
        banner_selectors_matched: [],
        host_count: hosts.size,
      };
    })();

    const winner = await Promise.race([
      captureTask.then((r) => ({ kind: 'done' as const, r })),
      wallTimer.promise.then(() => ({ kind: 'wall' as const })),
    ]);

    if (winner.kind === 'wall') {
      return errorResult(url, hosts.size, 'wall_clock');
    }

    // If a host-count breach fired during the race we still finished
    // the capture (or we got close-induced rejection); honor the breach.
    if (breach) {
      return errorResult(url, hosts.size, breach);
    }

    return winner.r;
  } catch (err) {
    if (breach) return errorResult(url, hosts.size, breach);
    if (wallTimer.fired) return errorResult(url, hosts.size, 'wall_clock');
    return {
      status: 'blocked',
      url,
      a11y_tree: [],
      banner_selectors_matched: [],
      host_count: hosts.size,
      blocked_reason: shortError(err),
    };
  } finally {
    wallTimer.cancel();
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

// — helpers ———————————————————————————————————————————————

function errorResult(url: string, host_count: number, breach_reason: BreachReason): CaptureResult {
  return {
    status: 'error',
    url,
    a11y_tree: [],
    banner_selectors_matched: [],
    host_count,
    breach_reason,
  };
}

function shortError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 200);
  return String(e).slice(0, 200);
}

function defaultHostExtractor(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
}

class WallClockTimer {
  fired = false;
  private timer: NodeJS.Timeout | undefined;
  promise: Promise<void>;
  constructor(ms: number) {
    this.promise = new Promise((ok) => {
      this.timer = setTimeout(() => {
        this.fired = true;
        ok();
      }, ms);
    });
  }
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

// — CDP type shims ————————————————————————————————————————

type AxProperty = { name: string; value: { type: string; value?: unknown } };
type AxNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  role?: { type: string; value?: string };
  name?: { type: string; value?: string };
  description?: { type: string; value?: string };
  value?: { type: string; value?: string };
  properties?: AxProperty[];
  ignored?: boolean;
};

type DomNode = {
  nodeName?: string;
  nodeType?: number;
  children?: DomNode[];
  contentDocument?: DomNode;
  shadowRoots?: DomNode[];
};

function countDomNodes(node: DomNode): number {
  let n = 1;
  for (const c of node.children ?? []) n += countDomNodes(c);
  for (const s of node.shadowRoots ?? []) n += countDomNodes(s);
  if (node.contentDocument) n += countDomNodes(node.contentDocument);
  return n;
}

/**
 * Serialize the full AX tree (flat list of nodes from CDP) into a
 * hierarchy rooted at the topmost non-ignored node. Ignored nodes are
 * skipped but their children are reparented up — that's how Chromium
 * itself surfaces them to assistive tech.
 *
 * The output matches the SPIRIT of pages/snapshot-*.md examples in the
 * growth repo: role + name + heading levels + image alt + button labels
 * + reading order via DOM traversal order.
 */
function serializeAxTree(nodes: AxNode[]): A11yNode[] {
  const byId = new Map<string, AxNode>();
  for (const n of nodes) byId.set(n.nodeId, n);

  // Find roots: nodes whose parent isn't in the map (or that have no parent).
  const roots: AxNode[] = [];
  for (const n of nodes) {
    if (!n.parentId || !byId.has(n.parentId)) roots.push(n);
  }

  const visit = (n: AxNode): A11yNode[] => {
    const role = n.role?.value ?? '';
    const ignored = n.ignored === true || role === 'none' || role === 'presentation';
    const childIds = n.childIds ?? [];
    const childNodes: A11yNode[] = [];
    for (const cid of childIds) {
      const c = byId.get(cid);
      if (c) childNodes.push(...visit(c));
    }
    if (ignored) return childNodes;

    const name = (n.name?.value ?? '').trim();
    const out: A11yNode = { role, name, children: childNodes };

    // Heading level: AX exposes it as a property `level`.
    const levelProp = n.properties?.find((p) => p.name === 'level');
    if (levelProp && typeof levelProp.value.value === 'number') {
      out.level = levelProp.value.value;
    }

    const value = n.value?.value;
    if (typeof value === 'string' && value.length > 0) out.value = value;

    const description = n.description?.value;
    if (typeof description === 'string' && description.length > 0) {
      out.description = description;
    }

    return [out];
  };

  const collected: A11yNode[] = [];
  for (const r of roots) collected.push(...visit(r));
  return collected;
}
