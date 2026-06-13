/** Strip an optional `data:<mime>;base64,` prefix from a base64 string. */
export function stripDataUrl(b64: string): string {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(b64);
  return m ? m[1]! : b64;
}

/** Decode a (possibly data-URL-prefixed) base64 string to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(stripDataUrl(b64), "base64"));
}

/** Read width/height from a PNG's IHDR chunk. Returns null if not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
