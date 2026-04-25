# infra/capture/test — egress isolation acceptance tests

Tests the spec §5.13 (network namespace + iptables) and §2 #5 (egress
policy quantified) acceptance scenarios for issue #33:

1. **Internal-IP DROP** — a process inside the netns cannot reach
   `169.254.169.254` (cloud metadata), `127.0.0.1`, RFC1918, `::1`,
   `fe80::`, `fc00::`, `2001:db8::`.
2. **Allowed-IP ACCEPT** — the same process reaches the resolved
   target IP successfully.
3. **IPv6 cloud-metadata alias** — `fd00:ec2::254` is blocked.
4. **Cross-eTLD+1 redirect** — capture starts at `a.com`, redirect
   target `b.com` is not pre-resolved → re-check rejects.
5. **Host-budget abort** — 60 distinct subresource hosts → enforcer
   reports `breach_reason=host_count` and exits non-zero at 50.

## Where the tests live

- `dryrun.test.sh` — run on every CI runner (Linux + macOS). Drives
  `netns-bringup.sh` with `WILLBUY_DRY_RUN=1`, asserts the rendered
  iptables ruleset has the right shape (default-deny, all deny CIDRs
  present, allowed IPs only on 80/443). No NET_ADMIN required.
- `cidr.test.sh` — pure-shell CIDR-membership unit tests. Covers IPv4
  + IPv6 edge cases (zero-length prefix, `::` expansion, exact match).
- `redirect.test.sh` — exercises the state-file format + redirect
  re-check parser.
- `privileged.test.sh` — runs ONLY on the `egress-integration` CI job
  (Linux + sudo). Creates a real netns, programs iptables, and uses
  `nc` / `curl` from inside the netns to assert the 5 acceptance
  scenarios end-to-end.

## Privileged runner requirements

The privileged job needs:

- Linux (kernel ≥ 4.x with netns support — every modern distro).
- `iptables`, `ip6tables`, `iproute2`, `conntrack`, `nc` (BSD or OpenBSD), `curl`.
- Either root or `CAP_NET_ADMIN`. On `ubuntu-latest` GitHub runners,
  `sudo` is passwordless and gives us root, which is sufficient.

`.github/workflows/ci.yml` defines the `egress-integration` job; see
that file for the exact runner config. Locally:

```sh
# Quick-feedback (no privilege needed):
infra/capture/test/dryrun.test.sh
infra/capture/test/cidr.test.sh
infra/capture/test/redirect.test.sh

# Full integration (Linux + sudo):
sudo WILLBUY_PRIVILEGED=1 infra/capture/test/privileged.test.sh
```

The privileged tests bind to local-only addresses inside the netns and
NEVER hit the public internet — the "target IP" is a loopback HTTP
fixture in a sibling netns, so the test is hermetic and safe to run in
any environment that meets the prereqs.
