/**
 * `page_captures` row writer abstraction. Production wires this to a
 * Postgres client. Tests pass `inMemoryCaptureStore()`. CI never touches
 * a live database (per issue #32 coordination note).
 */

export type PageCaptureRow = {
  capture_id: string;
  status: 'ok' | 'blocked' | 'error';
  a11y_object_key: string;
  screenshot_object_key: string | null;
  banner_selectors_matched: string[];
  overlays_unknown_present: boolean;
  blocked_reason: string | null;
  host_count: number;
  breach_reason: string | null;
  redactor_v: number;
  created_at: string;
};

export type CaptureStore = {
  insert(row: PageCaptureRow): Promise<void>;
};

export function inMemoryCaptureStore(): CaptureStore & {
  rows(): PageCaptureRow[];
} {
  const all: PageCaptureRow[] = [];
  return {
    async insert(row) {
      all.push(row);
    },
    rows() {
      return [...all];
    },
  };
}
