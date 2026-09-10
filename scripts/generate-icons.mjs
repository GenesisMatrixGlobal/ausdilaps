/**
 * Regenerates app/favicon.ico and app/apple-icon.png from the tower mark.
 *
 *   node scripts/generate-icons.mjs
 *
 * app/icon.svg is the source of truth for the mark and is hand-edited; this script only
 * exists because two of the three formats browsers still want cannot be an SVG. Run it only
 * when the mark changes — the outputs are committed, so a deploy never depends on it.
 *
 * The mark is the three towers alone. The wordmark and tagline are unreadable below ~64px,
 * and the logo's fine horizontal hatching and hairline circle alias into mush at 16px.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

// app/icon.svg is the ONE definition of the mark — read, never duplicated. An earlier
// version of this script carried its own copy of the tower rects, which is a silent drift
// waiting to happen: edit the SVG, regenerate, and the .ico quietly shows the old mark.
const source = readFileSync("app/icon.svg", "utf8");

/**
 * Rounded for the browser tab; FULL BLEED for Apple, which applies its own mask and would
 * otherwise show our rounded corners inset within its own rounding.
 */
const svg = (rounded) =>
  Buffer.from(rounded ? source : source.replace(' rx="6"', ""));

const png = (size, rounded) =>
  sharp(svg(rounded), { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/**
 * Minimal multi-size .ico. The format is a 6-byte header plus one 16-byte directory entry
 * per image, and since Vista each entry's payload may be a whole PNG — so no BMP encoding
 * is needed. 16/32/48 are included so a browser picks a size rather than downscaling one.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, data: await png(size, true) });
writeFileSync("app/favicon.ico", ico(images));

writeFileSync("app/apple-icon.png", await png(180, false));

console.log("favicon.ico  ", sizes.join("/"), "->", ico(images).length, "bytes");
console.log("apple-icon   180x180 ->", (await png(180, false)).length, "bytes");
