import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** QR options shared by the on-screen panel and printed labels (matches the server's error-correction level). */
const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 1, color: { dark: '#171717', light: '#ffffff' } };

/**
 * Renders `text` (always the public verification URL) to a PNG data URL, client-side.
 * The QR never contains anything but that URL with the opaque public batch identifier.
 */
export function useQrDataUrl(text: string | null | undefined, width = 320) {
  const [state, setState] = useState<{ key: string; url: string | null; error: boolean }>({ key: '', url: null, error: false });
  const key = `${text ?? ''}|${width}`;

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    QRCode.toDataURL(text, { ...QR_OPTIONS, width })
      .then((url) => !cancelled && setState({ key, url, error: false }))
      .catch(() => !cancelled && setState({ key, url: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [text, width, key]);

  const current = state.key === key;
  return { dataUrl: current ? state.url : null, error: current && state.error, loading: !!text && !current };
}

/** Host + path shown on labels, e.g. "medichain.example/verify". */
export function verifyHost(verificationUrl: string) {
  try {
    const u = new URL(verificationUrl);
    return `${u.host}/verify`;
  } catch {
    return verificationUrl.replace(/\/[^/]*$/, '');
  }
}
