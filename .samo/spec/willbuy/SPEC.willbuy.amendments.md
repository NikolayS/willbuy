# SPEC amendments — willbuy

Append-only. Each entry is dated and links the PR + issue that drove it.

---

## 2026-04-24 — A1: `next_action` enum + conversion-weighted score align with growth scoring rubric

**Affects:** §2 #15 (visitor output schema — `next_action` enum), §2 #18 (conversion-weighted aggregation weights), §2 #19 (paired statistics — McNemar binarization rule).

**Driver:** Issue #4 (PR `feat/4-shared`). The growth team's `ab/pricing-page-2026apr/scoring.md` (postgres-ai/growth) is the authoritative pricing-page rubric for the willbuy.dev launch dogfood study (§3 user story #4) and the postgres.ai pricing experiment that funds it. The pricing page optimizes for **paid conversion**, not free-tier signups. The rubric in §2 #18 (`purchase`, `contact_sales`, `signup_free`, `bookmark`, `browse_more`, `leave`) was drafted ahead of that growth work and undercounts paid intent (it has no slot for `book_demo`, `start_paid_trial`, `ask_teammate`, or paid-tier-anchored bookmarking) and treats `signup_free` as inherently a partial win. The growth rubric splits paid vs free-with-paid-consideration and adds a tier-aware bump.

**Amendment.** The `next_action` enum and conversion-weighted score adopt the growth rubric verbatim:

`next_action` enum (8 values, replaces the 6-value list in §2 #15 and §2 #18):

- `purchase_paid_today`
- `contact_sales`
- `book_demo`
- `start_paid_trial`
- `bookmark_compare_later`
- `start_free_hobby`
- `ask_teammate`
- `leave`

Conversion-weight base map (replaces §2 #18):

| `next_action`              | Base weight |
| -------------------------- | ----------- |
| `purchase_paid_today`      | 1.0         |
| `contact_sales`            | 0.8         |
| `book_demo`                | 0.8         |
| `start_paid_trial`         | 0.6         |
| `bookmark_compare_later`   | 0.0 (bumped to 0.3 if `tier_picked_if_buying_today` ∈ paid) |
| `start_free_hobby`         | 0.0 (bumped to 0.2 if `highest_tier_willing_to_consider` ∈ paid) |
| `ask_teammate`             | 0.2         |
| `leave`                    | 0.0         |

`paid_tiers = {"express", "starter", "scale", "enterprise"}` (per growth rubric).

`scoreVisit(parsed, tierToday?, considered?)` returns the bumped weight per the rules above; unknown actions return `0.0`.

**McNemar binarization (§2 #19) follow-on.** Update the canonical v0.1 rule: `converted = 1 IFF next_action ∈ {purchase_paid_today, contact_sales, book_demo, start_paid_trial}`; otherwise `0`. (`bookmark_compare_later` and `start_free_hobby` remain `0` for the binary collapse even when their bump fires — the bump is an intent-strength gradient, not a conversion event.) The "paired score is a different quantity than the binary collapse" disclaimer in §2 #19 still applies.

**What is NOT changed.** Per-field length caps (§2 #15: `first_impression` ≤ 400, list items ≤ 200, ≤ 10 items per list, `reasoning` ≤ 1200), `max_tokens=800`, schema-repair retry semantics (§2 #14), idempotency contract (§2 #15/#16), paired-stats disagreement rule (§2 #19) — all unchanged.

**Backstory dimensions.** §2 #5 enumerates backstory fields generically (stage, team_size, stack, pain, entry point, budget authority); the growth repo's `personas/backstories.md` pins concrete value sets for the launch dogfood and the postgres.ai study. Issue #4 wires those concrete value sets into the zod schema. This is a refinement of §2 #5 within its existing shape, not a deviation; recorded here for traceability.

**Tracking.** PR #N (set on merge). Future spec rev rolls this amendment back into §2 #15 / §2 #18 / §2 #19 inline.

---

## 2026-04-24 — A2: HDBSCAN `metric='euclidean'` on L2-normalized embeddings is equivalent to `metric='cosine'`

**Affects:** §17 (HDBSCAN params: `cosine distance`).

**Driver:** PR #39 (issue #31). Spec §17 specifies `cosine distance` for HDBSCAN; the implementation uses `metric='euclidean'` on L2-normalized embedding vectors.

**Rationale.** For two L2-normalized vectors **u** and **v** (‖u‖₂ = ‖v‖₂ = 1):

```
euclidean(u, v)  = ‖u − v‖₂
                 = √(‖u‖² − 2·u·v + ‖v‖²)
                 = √(1 − 2·cosine_similarity(u,v) + 1)
                 = √(2·(1 − cosine_similarity(u,v)))
                 = √(2·cosine_distance(u,v))
```

Because the square-root transformation is strictly monotone, `euclidean` and `cosine` distance are **order-preserving on L2-normalized vectors**: for any triple (a, b, c), `euclidean(a,b) < euclidean(a,c)` iff `cosine(a,b) < cosine(a,c)`. HDBSCAN's mutual-reachability distance, MST edges, and EOM cluster extraction all operate on pairwise distance orderings, so the resulting cluster assignments are identical.

**Practical advantages of `metric='euclidean'` over `metric='cosine'` in hdbscan 0.8.33:**
- scipy's `cdist` + BLAS SGEMM is used for the pairwise matrix, which is faster and better-tested numerically than the cosine-distance path.
- Avoids a rare edge case in hdbscan's cosine path when vectors have near-zero norm (guarded in `_embed` anyway via `norms[norms == 0] = 1.0`, but belt-and-suspenders).

**What is NOT changed.** The `_embed` function still L2-normalizes every output row (line 102–104 of `cluster.py`). Removing that normalization would make `metric='euclidean'` no longer equivalent to cosine. Any future change to `_embed` that removes L2 normalization MUST also change `metric` back to `'cosine'` or re-derive the equivalence.

**Tracking.** PR #39 (issue #31). Future spec rev updates §17 to read "euclidean over L2-normalized vectors (equivalent to cosine; see amendment A2)".
