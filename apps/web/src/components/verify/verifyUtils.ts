/** Helpers shared by the public and in-app verification screens. */

export const PUBLIC_ID_PATTERN = /^MC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** True when the text looks like a URL (we leave URLs untouched while typing). */
export function looksLikeUrl(v: string) {
  return /[/:]/.test(v) || /^(https?|www\.)/i.test(v.trim());
}

/**
 * Extracts the MediChain identifier from raw scanner / input text.
 * Accepts a bare ID ("mc-hpw0-tk2y-exaf") or a verification URL (".../verify/MC-…").
 * Returns null when nothing usable is found.
 */
export function extractCode(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep the raw value */
  }
  const m = v.match(/\/verify\/([^/?#\s]+)/i);
  if (m) return m[1].toUpperCase().slice(0, 64);
  if (looksLikeUrl(v)) return null;
  const compact = v.toUpperCase().replace(/\s+/g, '');
  return compact ? compact.slice(0, 64) : null;
}

/** Live formatting for manual entry: uppercases and inserts dashes as MC-XXXX-XXXX-XXXX. URLs are left as typed. */
export function formatManualInput(value: string): string {
  if (looksLikeUrl(value)) return value;
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw === '' || raw === 'M') return raw;
  const body = (raw.startsWith('MC') ? raw.slice(2) : raw).slice(0, 12);
  if (!body) return 'MC';
  return `MC-${body.match(/.{1,4}/g)!.join('-')}`;
}
