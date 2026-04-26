# Pricing-page CTA audit

Status: AUDIT only. Per the v0.2 launch checklist (issue #125), CTA wiring
is the deliverable for a separate web-engineer issue. This document enumerates
the current state, flags every CTA against our paid-conversion goal, and
recommends the wiring change in TEXT only — no application code touched.

**Audit goal (manager memory, repeated here so reviewers don't have to dig):**
> The pricing page optimizes for **paid conversion**, not free signups.
> A CTA that funnels to "start_free" without first surfacing the paid
> tiers is a defect, not a win.

This audit covers:

1. The willbuy.dev landing page (`apps/web/app/page.tsx`).
2. The pricing page at `/pricing` (currently DOES NOT EXIST in the
   repository as of `main` @ 0d2b63a; called out below as the primary gap).
3. The `BuyCredits` component (`apps/web/components/credits/BuyCredits.tsx`),
   today reachable only behind dashboard auth.
4. Any sign-in or sign-up CTA on public surfaces.

## 1. Inventory

### 1a. Landing page (`/`, `apps/web/app/page.tsx`)

| # | CTA text         | Element            | Destination                          | Captures                      | Notes                                                                                                  |
| - | ---------------- | ------------------ | ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1 | "Read the spec"  | inline `<a>` link  | `https://github.com/NikolayS/willbuy` | nothing (external nav)        | Only CTA on the page. Sends a prospective buyer OUT of our domain to a GitHub repo that does NOT make a buying case. |

That is the entirety of `/` today. There is no "Buy", "Try", "Start free",
"Sign in", "See pricing", or "See sample report" CTA on the landing page.

### 1b. Pricing page (`/pricing`)

DOES NOT EXIST. `apps/web/app/pricing/` is not present on `main`. The issue
(#125) calls for one to be built; that is a separate engineering task and
is OUT OF SCOPE FOR THIS DOC. Wiring recommendations below are written so
that whoever lands the pricing page can implement them as a checklist.

### 1c. `BuyCredits` (`apps/web/components/credits/BuyCredits.tsx`)

Reachable only inside the authenticated dashboard. Three CTAs (one per
pack) plus a confirm button:

| # | CTA text                           | Destination                         | Captures                                       | Notes                                                                          |
| - | ---------------------------------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| 2 | Pack tile: `starter` $29           | sets local `selected = 'starter'`   | client-side state only                         | Three tiles; clicking sets selection but does NOT initiate Checkout.           |
| 3 | Pack tile: `growth` $99            | sets local `selected = 'growth'`    | client-side state only                         | Same shape.                                                                    |
| 4 | Pack tile: `scale` $299            | sets local `selected = 'scale'`     | client-side state only                         | Same shape.                                                                    |
| 5 | Confirm button ("Buy credits")     | `POST {apiBaseUrl}/checkout/sessions` with `pack_id` in body, then redirects to Stripe Checkout `url` from the response | Account API key (header), `pack_id`, and downstream Stripe Checkout collects card | Wiring is correct for paid conversion. Defaults to `growth` per the component file (re-confirm in code review). |

### 1d. Sign-in (`/sign-in`)

`apps/web/app/sign-in/page.tsx`. Magic-link only per spec §2 #25. No "Sign
up" surface — the magic-link flow auto-creates an account. Captures: email
address. Public, indexable.

### 1e. Other public surfaces

- `/r/[slug]` — public report viewer. No buy CTA today. **Recommendation
  in §3 below**: add a single tasteful "Run a study on your own page →
  see pricing" CTA on `/r/*` since these pages are share-link traffic
  from CRO consultants and their clients (highest-intent visitors we have).

## 2. Flagged CTAs (current state)

Against the manager-memory rule:

| Flag | Issue                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1   | Landing page has ZERO buying CTAs. The single CTA sends prospects to GitHub.                                                                                                                           |
| F2   | No `/pricing` page exists on a public surface. Buyers cannot see the three packs without first creating an account and reaching the dashboard. This is a paid-conversion defect, not a free-signup one. |
| F3   | Sign-in is the only writable public surface. Because magic-link doubles as signup (no card required), the implicit funnel today is `landing → sign-in → free dashboard → maybe buy`. That is exactly the "start_free funnel before the buyer has seen paid tiers" anti-pattern. |
| F4   | `/r/*` (the highest-intent public surface — someone is reading a real report) has no path to purchase.                                                                                                  |

There is no CTA literally named `start_free` in the codebase (we don't ship
a free tier per A7). But the *effective* funnel today behaves like one.
The fix is to surface the paid tiers BEFORE the magic-link sign-in, and to
make the sign-in CTA secondary to the buy CTA on the landing page.

## 3. Wiring recommendations (text only)

These are recommendations for the separate web-engineer issue. **Do not
land them in this PR.**

### 3a. `/` landing page

- Add primary CTA: **"See pricing →"** linking to `/pricing` (anchor link
  to `#packs` once that page exists).
- Add secondary CTA: **"See a sample report"** linking to a known-public
  `/r/<slug>` from the dogfood study (issue #86).
- Add tertiary CTA: **"Sign in"** linking to `/sign-in`. Tertiary, NOT
  primary, because we want the buyer to see paid tiers before the free
  account creation path.
- Keep a single small "Read the technical spec" link in the footer for
  the engineer audience; do NOT make it a primary CTA.

### 3b. `/pricing`

- Above-fold: one-line claim, three pack tiles (`starter` / `growth` /
  `scale` per A7) with USD prices + display-credit counts (per A7
  amendment, the parenthetical credit counts are display-only labels —
  do not let them drift from the canonical 1000 / 4000 / 15000 values).
- Each tile has a buy CTA wired to `POST /api/credits/checkout?pack=<id>`
  (the route from PR #71). Per the issue body, the route returns a 303
  redirect to Stripe Checkout — the front-end follows it.
- ABOVE the buy CTA on each tile: a link to a sample report (`/r/<slug>`)
  for that price point's likely use case, so the buyer sees value
  before checkout.
- BELOW the three tiles: "Sign in" for returning customers (secondary).
- DO NOT add a "Start free" CTA. We do not have a free tier; surfacing
  one would mis-set expectations and pull conversion away from paid.
- DO NOT add a sign-up form on this page. Sign-in / signup happens
  AFTER Stripe Checkout (the magic-link flow attaches credits to the
  email address Stripe captures).

### 3c. `BuyCredits` component

No CTA-text changes needed today. Two follow-ups for the web engineer:

- Confirm the default `selected` value is `growth` (the middle tier);
  per CRO orthodoxy the middle tier is the anchor and we should not
  default to `starter`.
- Verify the display-credit count math matches A7 (issue #73 was filed
  against this; if still open, fold the fix into the pricing-page work).

### 3d. `/r/*` report pages

- Add ONE tasteful CTA in a fixed footer-bar: "Run a study on your own
  page → see pricing" → `/pricing`. Do NOT autoplay, do NOT modal.
  The report is the value; the CTA is permission to buy.
- Do NOT capture any data on `/r/*` beyond what the share-token cookie
  already does. No tracking pixels, no email-capture popups. The
  spec's CSP and field-level logging policy (§5.10, §5.12) implicitly
  forbid most of these anyway.

## 4. What this audit does NOT do

- It does NOT propose pricing-tier changes. A7 stands.
- It does NOT modify `apps/web/app/page.tsx`, `apps/web/components/credits/BuyCredits.tsx`,
  or any other application code.
- It does NOT create `apps/web/app/pricing/page.tsx`. That page is
  the deliverable for a separate engineering issue, with the wiring
  recommendations in §3 as input.
- It does NOT speak to subscriptions vs packs. Packs stand for v0.1
  (per A7 and §5.6); the AWS-Marketplace-driven question of whether
  to add a recurring SKU is in `aws-marketplace-scoping.md` §5.

## 5. Cross-references

- `docs/launch/show-hn.md` — "pricing is three credit packs, no
  subscription, $29 / $99 / $299" must match the live `/pricing` page
  copy at launch. If pricing changes, the Show HN draft changes too.
- `docs/launch/aws-marketplace-scoping.md` §1 — keep tier names
  (`starter` / `growth` / `scale`) consistent across web, Stripe,
  and any future Marketplace dimension.
- Spec §1 (positioning), §2 #18 (`next_action` enum), A1 (growth-rubric
  `next_action` adoption), A7 (pack tier names + amounts).
