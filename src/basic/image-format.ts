/**
 * What an image's bytes say it is, whatever its filename says.
 *
 * Shared by the build (program-archive.ts), the submission bot and the in-app
 * workspace, so a diagram is judged the same way wherever it arrives. A renamed
 * HEIC or PDF passes every other check and then renders as a broken image on
 * the site; this is the check that catches it. Pure — no Buffer, no DOM.
 */

export type ImageFormat = 'png' | 'jpg' | 'webp';

export const IMAGE_FORMAT_NAME: Record<ImageFormat, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, prefix: number[], at = 0): boolean {
  return prefix.every((b, i) => bytes[at + i] === b);
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}
