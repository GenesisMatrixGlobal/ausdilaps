# Portfolio imagery

All 24 portfolio entries have an image. The eight images restored in October 2026 come from AusDilaps' previous website or its FY25/26 Capability Statement; no generated project imagery is used.

## Restored website photographs

Source archive: `~/Documents/AusDilaps-WP-Archive/uploads/2023/04/`.

| Portfolio project | Original archived filename | Public asset |
| --- | --- | --- |
| WestConnex | `Westconnex2-768x406-1.jpg` | `/portfolio/westconnex.jpg` |
| Zig Zag Railway | `ZigZagRailway-1536x1150-1.jpg` | `/portfolio/zig-zag-railway-blue-mountains.jpg` |
| Epping to Thornleigh Third Track | `a1ba24ef73b9992e25531023e66d86df.jpg` | `/portfolio/epping-to-thornleigh-third-track.jpg` |
| Transport for NSW Station Refresh | `AllawahRailwayStation-1536x1152-1.jpg` | `/portfolio/transport-for-nsw-station-refresh-project.jpg` |
| Australian War Memorial | `iStock-175381409-1.jpg` | `/portfolio/australian-war-memorial.jpg` |

Mappings were checked against each archived page's Open Graph image and inline image. The original website's unsuffixed Epping URL mistakenly contains Department of Prime Minister and Cabinet content. The genuine Epping project and its freight-train photograph are in the archive's `epping-to-thornleigh-third-track-2` page. The restored photograph illustrates the rail project; its alt text describes the train without asserting an exact location.

## Featured case-study photographs

Extracted directly from the embedded photographs in `public/AusDilaps-Capability-Statement-FY25-26.pdf`, preserving the source image bytes and excluding the document's curved masks, headings and icons.

| Case study | PDF page | Embedded image dimensions | Public asset |
| --- | --- | --- | --- |
| Main South Road Duplication | 16 | 300 x 430 | `/portfolio/main-south-road-duplication.jpeg` |
| Glenrowan Solar Farm | 17 | 560 x 315 | `/portfolio/glenrowan-solar-farm.png` |
| Ipswich Hospital | 18 | 720 x 434 | `/portfolio/ipswich-hospital.jpeg` |

The Main South Road photograph is limited to the resolution embedded in the source document. Its project-page hero preserves the portrait proportions and caps the display width at 300 pixels. Replace it with the original photograph at the same asset path if a higher-resolution copy becomes available, and adjust the portrait metadata if needed.

The portfolio cards and project-page heroes use Next.js image optimisation with responsive sizes. Project pages also expose their assigned photograph in Open Graph metadata.
