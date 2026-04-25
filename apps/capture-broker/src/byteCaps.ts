// RED stub. Implementation lands in the green commit.

export const BYTE_CAPS = {
  MESSAGE_BYTES: 32 * 1024 * 1024,
  A11Y_TREE_BYTES: 10 * 1024 * 1024,
  SCREENSHOT_BYTES: 5 * 1024 * 1024,
} as const;

export function decodedBase64Bytes(_b64: string): number | null {
  throw new Error('byteCaps not implemented');
}
