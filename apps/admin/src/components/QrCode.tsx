/**
 * A QR code, for scanning a TOTP secret into an authenticator app (P12-06).
 *
 * ## Why bwip-js and not a QR-specific library
 *
 * It is already a dependency of this repository — `certificate.renderer.ts`
 * uses it for the Code 39 and Datamatrix barcodes the Anerkennungsbescheid
 * requires — so it is already in the lockfile, already covered by the
 * `pnpm audit` gate, and adds no new supply-chain surface. A second encoder
 * would be a new package on the one screen an unauthenticated visitor can
 * reach, which is the worst place to take that trade.
 *
 * Writing one by hand was the other option and is worse: QR is Reed-Solomon
 * error correction plus eight mask patterns, and a subtly wrong encoder
 * produces a code that scans on the developer's phone and not the operator's.
 *
 * ## Why it fails quietly
 *
 * If rendering fails there is no error state, because there is nothing the
 * operator can do about it — and they do not need to. `SignIn` shows the
 * Base32 secret underneath for manual entry, which every authenticator app
 * accepts. The QR code is a convenience over a path that already works.
 */

import { useEffect, useRef } from "react";
import bwipjs from "bwip-js/browser";

export function QrCode(props: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { value, size = 180 } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    try {
      bwipjs.toCanvas(canvas, {
        bcid: "qrcode",
        text: value,
        scale: 3,
        // No human-readable text under it: the value is a 100-character URI
        // containing the secret, and printing it under the code would put a
        // credential on screen in a form somebody could photograph from across
        // the room without noticing what it was.
        includetext: false,
      });
    } catch {
      // See the header — the manual secret beneath is the working path.
    }
  }, [value]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded border border-gray-200 bg-white"
      // The code carries a secret, so it is not decorative — but reading the
      // URI aloud helps nobody. Naming what it is, is the useful description.
      role="img"
      aria-label="QR-Code zur Einrichtung der Authenticator-App"
    />
  );
}
