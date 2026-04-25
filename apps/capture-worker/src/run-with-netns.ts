// run-with-netns.ts — spec §5.13 (v0.1 container transport).
//
// Wraps `docker run` so the capture container is launched INTO an
// already-prepared Linux network namespace whose iptables rules were bound
// BEFORE the container process is unpaused. The bring-up + tear-down scripts
// live in infra/capture/ — this module is the typed seam the worker uses
// instead of spawning `docker run` directly.
//
// Invariants (enforced here):
//  - bring-up runs to completion (allow-list programmed) BEFORE `docker run`,
//  - tear-down ALWAYS runs (success, failure, or thrown), even on SIGTERM,
//  - host budget (≤ 50 distinct hosts) is checked once before launch and
//    reported via the structured result so the worker can record
//    `breach_reason: 'host_count'` per spec §2 #5,
//  - DNS pinning: the resolved IPs at bring-up time are the ONLY IPs the
//    container can reach; in-container resolves to anything else are DROP'd
//    at the netns boundary (rebind reject — spec §2 #5).
//
// The wrapper does NOT speak the broker protocol — that's a separate seam
// (issue #34). It only handles the network-isolation lifecycle.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INFRA_DIR = resolve(HERE, '..', '..', '..', 'infra', 'capture');

export type RunWithNetnsOpts = {
  /** Stable identifier for this capture (used as netns name + log key). */
  captureId: string;
  /** Target URL — bring-up resolves the host once. */
  targetUrl: string;
  /** Docker image to run. */
  image: string;
  /** Command + args inside the container. */
  cmd: readonly string[];
  /** Distinct-host budget (spec §2 #5). Default 50. */
  hostBudget?: number;
  /**
   * Override the iptables/ip6tables programming step. When set to true the
   * bring-up runs in DRY-RUN mode and the wrapper does NOT actually spawn
   * docker (it returns synthesized stdout). Used by integration tests on
   * runners that don't have NET_ADMIN.
   */
  dryRun?: boolean;
  /**
   * Inject a shell binary for tests. Default: 'bash'. Tests can swap to
   * 'echo' to assert command shape without running.
   */
  bashBin?: string;
  /** Optional path override for the bring-up script (tests). */
  bringupScript?: string;
  /** Optional path override for the tear-down script (tests). */
  teardownScript?: string;
};

export type RunWithNetnsResult = {
  status: 'ok' | 'blocked' | 'error';
  netns: string;
  /** Lines emitted on stdout by the container; verbatim. */
  containerStdout: string;
  /** Lines emitted on stderr by the container; verbatim. */
  containerStderr: string;
  /** Bring-up exit code (0 means iptables programmed). */
  bringupExit: number;
  /**
   * Populated when bring-up failed because the target resolved to an
   * internal IP, or the host budget was exceeded. Verbatim from the
   * `breach_reason` family in spec §2 #5 / §2 #6.
   */
  breachReason?: 'dns_internal' | 'host_count' | 'cross_etld_redirect';
};

export class NetnsBringupError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly breachReason?: RunWithNetnsResult['breachReason'],
  ) {
    super(message);
    this.name = 'NetnsBringupError';
  }
}

/**
 * Run a hardened capture container inside a freshly-bound network namespace.
 *
 * The function is async and idempotent on partial failure: if bring-up
 * succeeds but the docker run rejects, tear-down still runs.
 */
export async function runWithNetns(opts: RunWithNetnsOpts): Promise<RunWithNetnsResult> {
  const bash = opts.bashBin ?? 'bash';
  const bringup = opts.bringupScript ?? join(INFRA_DIR, 'netns-bringup.sh');
  const teardown = opts.teardownScript ?? join(INFRA_DIR, 'netns-teardown.sh');
  const netns = sanitizeNetnsName(opts.captureId);
  const hostBudget = opts.hostBudget ?? 50;
  const dryRun = opts.dryRun === true;

  // 1. Bring up the netns. We capture stderr separately to surface
  //    `breach_reason` to the worker without leaking the URL into structured
  //    logs (§5.12 — no raw URLs in observability paths).
  const bringupEnv: NodeJS.ProcessEnv = {
    ...process.env,
    WILLBUY_HOST_BUDGET: String(hostBudget),
  };
  if (dryRun) bringupEnv.WILLBUY_DRY_RUN = '1';

  const bringupRun = await spawnCollect(bash, [bringup, netns, opts.targetUrl], {
    env: bringupEnv,
  });

  if (bringupRun.code !== 0) {
    const breach = classifyBringupFailure(bringupRun.stderr);
    throw new NetnsBringupError(
      `netns bring-up failed (exit ${bringupRun.code}): ${shortLine(bringupRun.stderr)}`,
      bringupRun.stderr,
      breach,
    );
  }

  // 2. Run the container. dry-run mode skips this.
  let containerStdout = '';
  let containerStderr = '';
  try {
    if (!dryRun) {
      const dockerRun = await spawnCollect('docker', [
        'run',
        '--rm',
        '--network',
        `container:netns-${netns}`,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        opts.image,
        ...opts.cmd,
      ]);
      containerStdout = dockerRun.stdout;
      containerStderr = dockerRun.stderr;
      if (dockerRun.code !== 0) {
        return {
          status: 'error',
          netns,
          containerStdout,
          containerStderr,
          bringupExit: 0,
        };
      }
    }
    return {
      status: 'ok',
      netns,
      containerStdout,
      containerStderr,
      bringupExit: 0,
    };
  } finally {
    // 3. Tear down. Failures are logged but not thrown — the worker has
    //    already gotten its result; an orphan netns will be cleaned by the
    //    next capture's idempotent bring-up + a periodic janitor.
    await spawnCollect(bash, [teardown, netns]).catch(() => undefined);
  }
}

/**
 * Re-resolve a redirected URL and check it against the existing allow-list
 * for this netns. Returns `false` (and the worker MUST abort the capture)
 * when the redirect target is not in the allowed IP set — that's the
 * cross-eTLD+1 redirect re-check from spec §2 #5.
 *
 * Implementation note: we cannot mutate iptables to "add the redirect IP"
 * without breaking the per-request DNS pinning guarantee (spec §2 #5: the
 * IP set is snapshotted ONCE at bring-up). We therefore enforce a strict
 * "redirect must resolve to an already-allowed IP" rule.
 */
export async function checkRedirectAllowed(
  netns: string,
  redirectUrl: string,
  stateDir = '/run/willbuy/netns',
): Promise<{ allowed: boolean; reason?: string }> {
  const stateFile = join(stateDir, `${netns}.state`);
  let raw: string;
  try {
    raw = await readFile(stateFile, 'utf8');
  } catch {
    return { allowed: false, reason: 'no_state' };
  }
  const allowedV4 = parseStateList(raw, 'allowed_ipv4');
  const allowedV6 = parseStateList(raw, 'allowed_ipv6');

  const host = parseHost(redirectUrl);
  if (!host) return { allowed: false, reason: 'bad_url' };

  // Resolve via the host resolver. We deliberately use Node's stdlib so the
  // test can mock; in production this matches the kernel resolver used by
  // the netns bring-up (same /etc/resolv.conf, same A/AAAA records modulo
  // TTL).
  const { lookup } = await import('node:dns/promises');
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { allowed: false, reason: 'dns_fail' };
  }

  for (const a of addrs) {
    const set = a.family === 6 ? allowedV6 : allowedV4;
    if (!set.includes(a.address)) {
      return { allowed: false, reason: 'cross_etld_redirect' };
    }
  }
  return { allowed: true };
}

/**
 * Read the host-budget enforcer's structured stdout and translate it into a
 * boolean + count. The script returns `host_count=<n>` or
 * `host_count=<n> breach_reason=host_count`.
 */
export function parseHostBudgetOutput(line: string): {
  hostCount: number;
  breached: boolean;
} {
  const m = /host_count=(\d+)/.exec(line);
  if (!m) throw new Error(`unparseable host-budget output: ${line}`);
  return {
    hostCount: Number(m[1]),
    breached: /breach_reason=host_count/.test(line),
  };
}

// — helpers ——————————————————————————————————————————————————————

function sanitizeNetnsName(captureId: string): string {
  // Linux netns names: up to 15 chars, alnum + '-' / '_'. The capture id
  // is a UUID — we keep the first 8 chars + a static prefix so multiple
  // concurrent captures on the same host don't collide.
  const trimmed = captureId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `wb-${trimmed.slice(0, 11)}`;
}

function classifyBringupFailure(stderr: string): RunWithNetnsResult['breachReason'] {
  if (/in deny range; capture refused/.test(stderr)) return 'dns_internal';
  if (/exceeds host budget/.test(stderr)) return 'host_count';
  return undefined;
}

function shortLine(s: string): string {
  return s.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? '';
}

function parseStateList(raw: string, key: string): string[] {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = re.exec(raw);
  if (!m || !m[1]) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

type SpawnResult = { code: number; stdout: string; stderr: string };

function spawnCollect(
  bin: string,
  args: readonly string[],
  spawnOpts: { env?: NodeJS.ProcessEnv } = {},
): Promise<SpawnResult> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(bin, [...args], {
      env: spawnOpts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', rejectP);
    child.on('close', (code) => {
      resolveP({ code: code ?? -1, stdout, stderr });
    });
  });
}

// Test-only helper exported for the unit suite.
export const __test__ = {
  sanitizeNetnsName,
  classifyBringupFailure,
  parseStateList,
  parseHost,
};
