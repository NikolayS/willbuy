# AWS Marketplace listing — scoping

Status: SCOPING ONLY. This document does NOT submit a listing, file any
AWS forms, or commit us to a launch date. Per issue #125 and SPEC §8 the
Marketplace listing is post-v0.2 (target Q3 2026); the goal here is to know
what's in front of us before we start.

## 1. Listing-type decision

**Decision: SaaS Subscriptions (default).** Recommendation, not yet ratified.

| Option              | Fit for willbuy v0.1                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| SaaS Subscriptions  | Best fit. Buyer subscribes via Marketplace; AWS bills per-unit usage we report against published dimensions. We already have a `provider_attempts` ledger and a `credit_ledger` that can emit usage records. Self-serve. |
| SaaS Contracts      | Annual / multi-year prepaid contracts. Indie-hacker ICP doesn't sign annual contracts up front; we'd lose the "one $29 pack and try it" loop. Revisit when we land a fintech buyer (post-SOC 2, per §9 of the spec). |
| Free + Pay-go (BYOL)| Not applicable — we don't ship infra into the buyer's AWS account.                                              |
| Professional Services / AMI / Container | Not applicable. We're a SaaS, not a deployable artifact.                                          |

The default-to-Subscriptions recommendation aligns with the spec's
v0.1 credit-pack pricing (A7: `starter` $29 / `growth` $99 / `scale` $299)
without forcing a tier rename. Mapping to Marketplace dimensions:

- One usage dimension per pack tier, billed monthly via `MeterUsage` /
  `BatchMeterUsage` with idempotency keys derived from
  `credit_ledger.id` (re-using our existing webhook idempotency pattern).
- Alternative we considered and rejected for v0.2: a single "credits"
  dimension with variable quantity. AWS reporting docs are happier with
  fixed-name dimensions, and our packs are already discrete.

Open question for the AWS partner team (see §5): can we reuse the same
Stripe-style pack semantics in Marketplace, or does Marketplace expect
recurring-subscription semantics that would force us to introduce a
v0.2 subscription tier?

## 2. Required listing fields (initial inventory)

Sourced from AWS Marketplace Management Portal docs as of 2026-04. Confirm
with partner team before submission.

**Product metadata:**

- Product title, short description (≤150 chars), long description.
- Logo (`.png`, transparent, ≥300×300).
- Highlights (3 short bullets) and product video (optional but recommended).
- Categories: `DevOps Tools`, `Productivity`, possibly `Marketing`.
- Search keywords.

**Pricing & dimensions:**

- One Subscriptions dimension per pack (`starter`, `growth`, `scale`),
  USD price matching A7.
- Free trial policy (none in v0.1; flagged as open question — Marketplace
  buyers may expect one).
- Refund policy URL.

**Buyer-facing legal:**

- End User License Agreement (EULA) — either AWS Standard Contract for
  Marketplace (SCMP) or our own. **Recommendation:** start with SCMP to
  ship; switch to a custom EULA only if Marketplace buyer requests force
  changes (e.g. data-residency commitments).
- Privacy notice URL (`willbuy.dev/privacy`).
- Refund / cancellation policy URL.
- Support contact (`support@willbuy.dev`).

**Technical integration:**

- Marketplace fulfillment URL (the post-purchase landing page that
  receives the AWS-issued `x-amzn-marketplace-token`).
- AWS account ID for the seller account.
- IAM role for `aws-marketplace:MeterUsage` / `BatchMeterUsage` /
  `ResolveCustomer`.
- SNS topic ARN for entitlement / subscription notifications
  (`aws-marketplace-entitlement-notification` and
  `aws-marketplace-subscription-notification`).

**Compliance:**

- Tax registration (US states + EU VAT if applicable).
- AWS Foundational Technical Review (FTR) — flagged as a likely
  prerequisite, especially for Subscriptions listings; need the AWS
  Partner team to confirm.
- Data-handling disclosures (we ALREADY have a redaction policy per
  §5.9; this maps directly).

## 3. Customer onboarding flow — integration points

The buyer journey for SaaS Subscriptions is well documented; the four
integration points we have to build are:

1. **Marketplace fulfillment landing.** A new route, e.g.
   `apps/web/app/aws-marketplace/fulfill/page.tsx`, that receives the
   POST from Marketplace with `x-amzn-marketplace-token`. We call
   `ResolveCustomer` to exchange the token for a `CustomerIdentifier`
   and `ProductCode`, then either:
   - **Sign in with AWS path (preferred for SaaS Subscriptions):** redirect
     the buyer to our sign-in page with a one-time `marketplace_link_token`
     cookie; on first sign-in (magic link per spec §2 #25 / §8) we attach
     the AWS `CustomerIdentifier` to their willbuy account.
   - **Contract-redirect handshake (fallback):** if the buyer is already
     signed in (existing willbuy account upgrading via Marketplace),
     attach immediately and redirect to `/dashboard?marketplace=linked`.
2. **Entitlement / subscription notifications.** SNS-subscribed Lambda (or
   a dedicated webhook on our API) consumes `subscribe-success`,
   `unsubscribe-pending`, `unsubscribe-success`. Each event writes to a
   new `aws_marketplace_events` table (mirrors our existing Stripe
   webhook pattern with `event.id` as ledger idempotency key per §5.8).
3. **Usage metering.** A scheduled job (hourly) reads
   `credit_ledger.kind = 'top_up'` rows tagged `source = 'aws_marketplace'`
   and emits `BatchMeterUsage` records with idempotency keys derived from
   `credit_ledger.id`. We do NOT meter live spend per-visit — the
   Marketplace dimension is "pack purchased," not "credits consumed,"
   matching our Stripe model.
4. **Account model changes.** `accounts` table gets two nullable columns:
   `aws_marketplace_customer_identifier` (encrypted, KMS envelope per
   §2 #32) and `aws_marketplace_product_code`. Each account can have AT
   MOST ONE Marketplace linkage in v1; multi-link is a future-us problem.

## 4. What we do NOT have today

(This is the gap list — the actual scoping value of this doc.)

- A Marketplace seller account (creation requires US tax + bank info; the
  founder needs to file).
- AWS Partner Network (APN) registration.
- An EULA, even SCMP, signed off by counsel (we have a stub `terms.md`
  in the repo that is NOT production-grade).
- The Sign in with AWS / fulfillment endpoint (no app code yet).
- A FTR submission. Likely 2–4 weeks of back-and-forth.
- Tax registration in US states beyond our current footprint.
- Data-residency stance (Marketplace buyers in EU may ask for EU-region
  hosting; we are Hetzner Ashburn today per the spec's `/infra/README.md`).
- A documented refund policy (we have the credit-pack model but no SLA
  on refunds; needs to align with spec §5.4 reconcile job).

## 5. Open questions for the AWS partner team

1. Does our credit-pack pricing model (one-time pack purchase, no
   recurrence) fit the SaaS Subscriptions billing model, or does
   Subscriptions require recurring billing? If it requires recurrence,
   should we introduce a "subscription credit pack" (e.g. monthly
   auto-top-up) for the Marketplace SKU only, or move to SaaS Contracts?
2. Is the Foundational Technical Review (FTR) a hard prerequisite for a
   SaaS Subscriptions listing, or only for AMI / Container listings?
3. Are there partner-team-recommended SCMP carve-outs for vendors that
   handle third-party-page captures (relevant to our §5.9 data classification)?
4. Listing-page best practices for indie / single-founder vendors —
   any minimum-viable trust signals (e.g. AWS Partner Tier) that buyers
   filter by, that would block visibility for an unaffiliated seller?
5. SLA expectations on Marketplace listings: do buyers expect 99.9% / 99.95%,
   and is a missing SLA disclosure a launch blocker?
6. Multi-region listing (AWS Marketplace per-region pricing) — is single-region
   USD-only acceptable for v1?
7. Cancellation flow: when a buyer unsubscribes mid-month, do we still
   meter the unused capacity, or is the contract closed at
   `unsubscribe-success`? Affects how we handle leftover credits.

## 6. Rough timeline

Out of scope for v0.2 launch. Indicative only:

- T+0 (post-v0.2 launch): file APN registration + Marketplace seller account.
- T+2–4 weeks: FTR submission + EULA / privacy / refund policy review.
- T+4–8 weeks: implement fulfillment endpoint + SNS handler + metering job
  on a feature branch behind a flag.
- T+8–10 weeks: submit listing draft, iterate with AWS partner team.
- Target go-live: Q3 2026, conditional on the v0.2 SOC 2 / fintech-buyer
  expansion track per spec §9.

## 7. Explicit non-goals (this doc)

- We are not creating the Marketplace listing in this PR.
- We are not making the FTR submission in this PR.
- We are not changing pricing tiers (Nik decides those; A7 stands).
- We are not renaming the existing Stripe price IDs.
