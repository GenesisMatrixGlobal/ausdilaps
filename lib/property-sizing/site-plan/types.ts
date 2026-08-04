export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PdfPageImage {
  page: number; // 1-indexed
  jpeg: Buffer;
  pixelWidth: number;
  pixelHeight: number;
  pointWidth: number;
  pointHeight: number;
}

export interface ColorSwatch {
  rgb: Rgb;
  hex: string;
  pixelCount: number;
  samplePngBase64: string;
}

export interface PagePreview {
  page: number;
  previewPngBase64: string;
  pixelWidth: number;
  pixelHeight: number;
  pointWidth: number;
  pointHeight: number;
}

export interface PreviewResponse {
  pages: PagePreview[];
  swatches: ColorSwatch[];
}

export type SplitConfidence = "single" | "split" | "unlabeled";

export type ExternalSource = "google-solar" | "osm";
// "reference_only": an external footprint was found, but this code shares its blob with other
// codes (a touching cluster) or was itself assembled from several disconnected fragments, so
// there's no reliable way to attribute a per-code share of the external area — shown for
// context, never scored as a pass/fail.
export type ExternalStatus = "match" | "mismatch" | "not_found" | "not_checked" | "reference_only";

export interface SitePlanResult {
  code: string;
  page: number;
  areaSqm: number;
  pixelCount: number;
  confidence: SplitConfidence;
  flags: string[];
  externalSource: ExternalSource | null;
  externalAreaSqm: number | null;
  externalDeltaPct: number | null;
  externalStatus: ExternalStatus;
}

export interface LatLngInput {
  lat: number;
  lng: number;
}

export interface CalibrationInput {
  pointA: { pixel: { x: number; y: number }; latLng: LatLngInput };
  pointB: { pixel: { x: number; y: number }; latLng: LatLngInput };
}

export interface MeasureRequest {
  pdf: { data: string; mediaType: string };
  scaleRatio: number;
  color: Rgb;
  tolerance?: number;
  calibration?: CalibrationInput;
}
