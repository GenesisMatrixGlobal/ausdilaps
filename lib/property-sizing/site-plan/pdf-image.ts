// Pulls the single flattened basemap JPEG out of each page of a GIS-exported site plan
// PDF (ArcGIS/QGIS "print to PDF" output), plus the page's physical point dimensions for
// scale calibration. These drawings embed the whole map — imagery, building fills, labels —
// as one raster XObject per page; there is no vector building geometry to read.
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import type { PdfPageImage } from "./types";

export async function extractPageImages(pdfBytes: Buffer): Promise<PdfPageImage[]> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const images: PdfPageImage[] = [];

  for (let i = 0; i < pdf.getPageCount(); i++) {
    const page = pdf.getPage(i);
    const { width: pointWidth, height: pointHeight } = page.getSize();
    const resources = page.node.Resources();
    const xobjectsObj = resources?.lookup(PDFName.of("XObject"));
    if (!xobjectsObj || !(xobjectsObj instanceof PDFDict)) continue;
    const xobjects = xobjectsObj;

    let jpeg: Buffer | null = null;
    for (const key of xobjects.keys()) {
      const ref = xobjects.get(key);
      const obj = pdf.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const filter = obj.dict.get(PDFName.of("Filter"));
      if (!filter || !String(filter).includes("DCTDecode")) continue;
      const raw = obj.getContents();
      // Keep the largest embedded JPEG on the page (the basemap), skip small icons/logos.
      if (!jpeg || raw.length > jpeg.length) jpeg = Buffer.from(raw);
    }
    if (!jpeg) continue;

    const meta = await sharp(jpeg).metadata();
    images.push({
      page: i + 1,
      jpeg,
      pixelWidth: meta.width ?? 0,
      pixelHeight: meta.height ?? 0,
      pointWidth,
      pointHeight,
    });
  }

  return images;
}
