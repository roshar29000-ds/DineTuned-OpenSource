export type LocalMenuFile = { file: File; kind: 'image' | 'pdf' | 'html'; bytes: number };
export const MAX_MENU_BYTES = 10 * 1024 * 1024;
export function detectMenuFormat(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'text/html' | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  const beginning = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
  if (beginning.startsWith('<!doctype html') || beginning.startsWith('<html') || beginning.includes('<html')) return 'text/html';
  return null;
}
export async function inspectLocalFile(file: File, imagesOnly = false): Promise<LocalMenuFile> {
  if (file.size === 0 || file.size > MAX_MENU_BYTES) throw new Error('Choose a non-empty file up to 10 MB.');
  const format = detectMenuFormat(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!format || (file.type && file.type !== format) || (imagesOnly && (format === 'application/pdf' || format === 'text/html'))
      || (format === 'text/html' && !['html', 'htm'].includes(extension || ''))) {
    throw new Error(imagesOnly ? 'Choose a JPEG, PNG, or WebP image.' : 'Choose a JPEG, PNG, WebP image, text PDF, or HTML file. This file’s format could not be confirmed.');
  }
  return { file, kind: format === 'application/pdf' ? 'pdf' : format === 'text/html' ? 'html' : 'image', bytes: file.size };
}
export function safeMenuUrl(raw: string): string | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
type Detector = { detect(image: ImageBitmap): Promise<{ rawValue: string }[]> };
type DetectorClass = { new(options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
export async function decodeQrFile(file: File): Promise<{ kind: 'link'; url: string } | { kind: 'unavailable' | 'not_found' | 'invalid' | 'multiple' }> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Detector || typeof Detector.getSupportedFormats !== 'function' || typeof createImageBitmap !== 'function'
    || !(await Detector.getSupportedFormats().catch((): string[] => [])).includes('qr_code')) return { kind: 'unavailable' };
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error('Choose a smaller image, up to 24 megapixels.');
    const results = await new Detector({ formats: ['qr_code'] }).detect(bitmap);
    if (!results.length) return { kind: 'not_found' };
    if (results.length !== 1) return { kind: 'multiple' };
    const url = safeMenuUrl(results[0].rawValue);
    return url ? { kind: 'link', url } : { kind: 'invalid' };
  } finally { bitmap.close(); }
}
