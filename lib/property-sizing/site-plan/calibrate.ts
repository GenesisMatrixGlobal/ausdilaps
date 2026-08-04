import type { PdfPageImage } from "./types";

const MM_PER_POINT = 25.4 / 72;

/**
 * A PDF page's point dimensions equal its intended physical print size (the whole point of
 * PDF page geometry). So given the drawing's stated print scale ("1:N"), one point on the
 * page always represents N * MM_PER_POINT millimetres in the real world — no need to know
 * paper size or detect a scale bar; it falls straight out of the page geometry.
 */
export function sqmPerPixel(image: PdfPageImage, scaleRatio: number): number {
  const metresPerPoint = (scaleRatio * MM_PER_POINT) / 1000;
  const metresPerPixelX = (image.pointWidth / image.pixelWidth) * metresPerPoint;
  const metresPerPixelY = (image.pointHeight / image.pixelHeight) * metresPerPoint;
  return metresPerPixelX * metresPerPixelY;
}
