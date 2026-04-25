// Spec §5.18 export+share — one-click PNG export of the headline delta
// + paired-delta plot for CRO consultants to drop into client decks.
//
// Implementation uses `html-to-image` (already a dependency) which
// serializes the DOM subtree to a PNG data URL. No inline scripts
// involved (CSP §5.10 stays clean).
//
// `_toPngForTest` is a test-only seam: the real `toPng` is imported
// dynamically so jsdom (which can't run a real canvas) doesn't blow up
// in the unit-test environment. Production code never passes this arg.

type ToPngFn = (
  node: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<string>;

let cached: ToPngFn | null = null;

async function loadHtmlToImage(): Promise<ToPngFn> {
  if (cached) return cached;
  const mod = (await import('html-to-image')) as { toPng: ToPngFn };
  cached = mod.toPng;
  return cached;
}

export interface ExportOptions {
  /** Test seam: pass a stub to avoid loading html-to-image in jsdom. */
  _toPngForTest?: ToPngFn;
  /** Forwarded to html-to-image. */
  pixelRatio?: number;
  /** Forwarded to html-to-image. */
  backgroundColor?: string;
}

export async function exportElementToPng(
  node: HTMLElement,
  options: ExportOptions = {},
): Promise<string> {
  const { _toPngForTest, pixelRatio = 2, backgroundColor = '#ffffff' } = options;
  const toPng = _toPngForTest ?? (await loadHtmlToImage());
  const dataUrl = await toPng(node, { pixelRatio, backgroundColor });
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('exportElementToPng: html-to-image returned an unexpected payload');
  }
  return dataUrl;
}
