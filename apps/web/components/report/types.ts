// Re-export the wire types as a stable surface for the report
// components. Components import from here (not from @willbuy/shared/report
// directly) so a future shape rename is a one-file edit.
export type { ReportT, VariantId, Tier, ThemeCategory } from '@willbuy/shared/report';

// View-level mode flag. Spec §5.18 export+share: `/r/:slug` renders the
// same page as the dashboard but WITHOUT the debug view.
export type ReportMode = 'dashboard' | 'public';
