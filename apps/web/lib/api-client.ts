/**
 * api-client.ts — typed fetch wrapper for the willbuy API (issue #34).
 *
 * Spec refs:
 *   §2 #1  — unverified domain returns 422
 *   §2 #18 — paired A/B = exactly 2 URLs
 *   §4.1   — web app → API server boundary
 *
 * Auth: for v0.1 we read the API key from NEXT_PUBLIC_DEV_API_KEY.
 * Real auth (Sprint 3) will replace this.
 *
 * All methods return a typed discriminated union:
 *   { ok: true; data: T }  |  { ok: false; status: number; error: string }
 *
 * The callers (form, status page) pattern-match on `ok` to decide which
 * inline error to render.
 */

import { z } from 'zod';

// ── Wire schemas ─────────────────────────────────────────────────────────────

// POST /studies request body (matches API's CreateStudyBodySchema exactly).
export const ICP_PRESETS = [
  'saas_founder_pre_pmf',
  'saas_founder_post_pmf',
  'shopify_merchant',
  'devtools_engineer',
  'fintech_ops_buyer',
] as const;

export type IcpPresetId = (typeof ICP_PRESETS)[number];

export interface CreateStudyBody {
  urls: string[];
  icp: { preset_id: IcpPresetId };
  n_visits: number;
}

// POST /studies 201 response.
const CreateStudyResponseSchema = z.object({
  study_id: z.number().int(),
  status: z.string(),
});
export type CreateStudyResponse = z.infer<typeof CreateStudyResponseSchema>;

// Study status values per spec §5.3.
export const STUDY_STATUSES = [
  'pending',
  'capturing',
  'visiting',
  'aggregating',
  'ready',
  'failed',
] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

// GET /studies/:id 200 response.
const GetStudyResponseSchema = z.object({
  id: z.number().int(),
  status: z.enum(STUDY_STATUSES),
  visit_progress: z.object({
    ok: z.number().int().min(0),
    failed: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  started_at: z.string(),
  finalized_at: z.string().nullable(),
  // slug is present once study is ready (populated by the report row).
  slug: z.string().optional(),
});
export type GetStudyResponse = z.infer<typeof GetStudyResponseSchema>;

// ── Typed result wrapper ─────────────────────────────────────────────────────

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

// ── API base URL ─────────────────────────────────────────────────────────────

function getApiBase(): string {
  // In Next.js, NEXT_PUBLIC_* env vars are inlined at build time and
  // available on both server and client.
  const base =
    typeof process !== 'undefined'
      ? (process.env['NEXT_PUBLIC_API_URL'] ?? '')
      : '';
  return base;
}

function getApiKey(): string {
  return typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_DEV_API_KEY'] ?? '')
    : '';
}

// ── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  opts: RequestInit,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, { ...opts, headers });
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok) {
    const errorMsg =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: errorMsg };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: res.status,
      error: `Response shape mismatch: ${parsed.error.issues.map((i: z.ZodIssue) => i.message).join('; ')}`,
    };
  }
  return { ok: true, data: parsed.data };
}

// ── Public API methods ───────────────────────────────────────────────────────

/**
 * POST /studies — create a new study.
 *
 * Error mapping for inline display:
 *   401 → redirect caller to sign-in (the form handles this).
 *   402 → "out of credits" message + buy-credits link.
 *   422 → "unverified domain" message + verify-domain link.
 */
export async function createStudy(
  body: CreateStudyBody,
): Promise<ApiResult<CreateStudyResponse>> {
  return apiFetch('/studies', { method: 'POST', body: JSON.stringify(body) }, CreateStudyResponseSchema);
}

/**
 * GET /studies/:id — fetch study status + visit progress.
 *
 * Used by the status page to poll every 5 s.
 */
export async function getStudy(
  id: string | number,
): Promise<ApiResult<GetStudyResponse>> {
  // Use /api/studies/:id (session-cookie auth) so authenticated dashboard users
  // can poll study status without needing an API key. The API-key path
  // /studies/:id remains for programmatic callers.
  return apiFetch(`/api/studies/${id}`, { method: 'GET' }, GetStudyResponseSchema);
}
