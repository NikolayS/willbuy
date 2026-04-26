# Show HN draft — willbuy.dev

Status: DRAFT, not yet posted. Posting is a manager-action, gated on the v0.2
launch checklist (issue #125) going green. Word count below excludes the title
and the first-comment template.

---

## Title

> Show HN: Willbuy.dev – paste a pricing page, get N synthetic visitors who tell you why they didn't buy

(70 chars, no buzzwords, frames the wedge in the title. Alternates kept below.)

Alternates:

- Show HN: A synthetic visitor panel for your pricing page
- Show HN: Willbuy – paired-A/B for landing pages with LLM visitors

## Body

I burned three months on a pricing page that converted at 0.4% and I never
figured out why, because I didn't have enough traffic to A/B test it. So I
built the thing I wanted.

Willbuy.dev is a synthetic visitor panel for conversion pages. You verify your
domain by DNS TXT, paste one URL (or two for paired A/B), pick a preset ICP
or write your own, and N independent fresh-context LLM "visitors" each render
the page and return a structured verdict: first impression, will-to-buy 0–10,
the questions they couldn't answer, the objections that stopped them, the
tier they'd pick if they were buying today, and a conversion-weighted next
action. The output is a shareable report, not a chat transcript.

The wedge is paired A/B. The same sampled backstory visits both variants in
two independent fresh-context calls — no shared `conversation_id`,
`session_id`, `thread_id`, or `previous_response_id`; an AST lint enforces
that across the adapter layer. Pairing is a DB join over results, never a
cross-call LLM context join. That gets you a within-subjects paired-delta
(paired-t + Wilcoxon + McNemar with an explicit disagreement banner) instead
of the noisier between-subjects average that any "throw it at GPT" approach
would give you.

Pricing is three credit packs, no subscription: $29 / $99 / $299. A typical
N=30 paired study against two URLs costs about $2. No free tier — credits
expire, and the per-visit cost is real LLM spend.

Ask: I'd love feedback from anyone who has paid for a CRO audit, anyone who's
tried to A/B-test on sub-1k-visit/day traffic, and anyone with red-team
intuition on synthetic-respondent overclaim. Sample report and a 5-page
benchmark are linked from the landing page.

---

## First-comment template

> Founder here, AMA. Backstory: I ran the postgres.ai pricing page through
> the same harness I built for Willbuy (under `growth/2026-apr/pricing-page/`
> in our monorepo if you're curious — paired stratified, N=20 per persona,
> two personas, fresh context per call). The top blocker every persona
> surfaced was the same thing I'd been ignoring for a month. That's the
> shape of the value: it doesn't tell you something a smart friend wouldn't,
> it just gets it in front of you in 90 seconds for $2 instead of in front
> of you in three weeks for $4k.
>
> Specifically NOT claiming: that these visitors are real humans, that
> synthetic feedback substitutes for live-traffic A/B testing once you have
> the traffic, or that we bypass bot detection (we identify as a bot to the
> target page in v0.1; capture happens in a hardened sandboxed container
> with default-deny egress and a Unix-socket-only host channel).
>
> Stack: Bun + Next.js (App Router) + self-hosted Supabase on Hetzner,
> Anthropic Haiku for the chat backend with prompt caching on the static
> system+schema prefix, local fastembed (`BAAI/bge-small-en-v1.5`, CPU ONNX)
> for embeddings, deterministic HDBSCAN inside a pinned scientific-stack
> container image. Reports render with Recharts, no PDF export in v0.1.
>
> Open questions I'd genuinely like HN's read on:
> 1. Where's the line between "useful synthetic respondent" and "plausible
>    slop"? Our ship gate is a 5-page blind benchmark with κ ≥ 0.6 across 3
>    labelers + a 4th adjudicator + a pre-registered false-positive rubric.
>    Is that strong enough to publish a top-3-blockers claim?
> 2. Pricing: credit packs vs. subscription. We picked packs because variance
>    in per-customer usage is huge. Anyone tried both and have a strong take?
> 3. Paired-A/B framing — is "within-subjects" obvious to non-stats readers,
>    or do we need to lead with a plain-English version (same backstory sees
>    both pages, so we subtract out the persona effect)?
