// @vitest-environment jsdom
//
// Unit tests for exportElementToPng() (lib/png-export.ts).
//
// The happy path is covered in report-viz.test.tsx test #4. This file
// covers the defensive error path: when the underlying html-to-image
// library returns something other than "data:image/png;base64,...",
// exportElementToPng throws rather than returning a corrupt data URL.
//
// It also verifies the options forwarding: pixelRatio and backgroundColor
// are passed to the underlying toPng function.

import { describe, expect, it, vi } from 'vitest';
import { exportElementToPng } from '../lib/png-export';

const VALID_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';

describe('exportElementToPng()', () => {
  it('returns the data URL when toPng returns a valid PNG', async () => {
    const stub = vi.fn(async () => VALID_DATA_URL);
    const result = await exportElementToPng(document.createElement('div'), {
      _toPngForTest: stub,
    });
    expect(result).toBe(VALID_DATA_URL);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('throws when toPng returns a non-PNG data URL', async () => {
    const stub = vi.fn(async () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    await expect(
      exportElementToPng(document.createElement('div'), { _toPngForTest: stub }),
    ).rejects.toThrow(/unexpected payload/i);
  });

  it('throws when toPng returns an empty string', async () => {
    const stub = vi.fn(async () => '');
    await expect(
      exportElementToPng(document.createElement('div'), { _toPngForTest: stub }),
    ).rejects.toThrow(/unexpected payload/i);
  });

  it('forwards pixelRatio and backgroundColor to the underlying toPng call', async () => {
    const stub = vi.fn(async (_node: HTMLElement, opts?: Record<string, unknown>) => {
      // Return a URL that varies with options so we can assert they were passed.
      return VALID_DATA_URL;
    });
    await exportElementToPng(document.createElement('div'), {
      _toPngForTest: stub,
      pixelRatio: 3,
      backgroundColor: '#ff0000',
    });
    expect(stub).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ pixelRatio: 3, backgroundColor: '#ff0000' }),
    );
  });

  it('defaults to pixelRatio=2 and backgroundColor=#ffffff', async () => {
    const stub = vi.fn(async () => VALID_DATA_URL);
    await exportElementToPng(document.createElement('div'), { _toPngForTest: stub });
    expect(stub).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ pixelRatio: 2, backgroundColor: '#ffffff' }),
    );
  });
});
