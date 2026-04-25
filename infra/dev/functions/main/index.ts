// infra/dev/functions/main/index.ts — placeholder edge function.
// Real edge functions, if any, land later. This stub is mounted into the
// supabase/edge-runtime container so the volume bind is non-empty.
Deno.serve(() => new Response('willbuy edge-functions placeholder\n', { status: 200 }));
