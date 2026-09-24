/**
 * Clients shown in the homepage logo bar.
 *
 * Only clients AusDilaps has already named publicly go here — never invent one.
 * Logos are the official files from each client's own website (downloaded
 * 2026-09-24), in /public/clients. `width`/`height` are the file's own
 * dimensions: the bar sizes every logo to the same visual area from them.
 * A client with no logo yet shows its name instead.
 */
export type Client = {
  name: string;
  logo?: { src: string; width: number; height: number };
};

export const CLIENTS: Client[] = [
  // data/portfolio.ts. TfNSW's own site header carries the NSW Government waratah.
  { name: "Transport for NSW", logo: { src: "/clients/transport-for-nsw.png", width: 259, height: 280 } },
  { name: "Lendlease", logo: { src: "/clients/lendlease.svg", width: 641, height: 181 } },
  { name: "Transurban", logo: { src: "/clients/transurban.svg", width: 994, height: 149 } },
  // Capability Statement FY25/26 case studies from here down.
  { name: "UGL", logo: { src: "/clients/ugl.png", width: 600, height: 148 } }, // Glenrowan Solar Farm
  { name: "Fleurieu Connections Alliance", logo: { src: "/clients/fleurieu-connections-alliance.svg", width: 322, height: 113 } }, // Main South Road Duplication
  // Ipswich Hospital. Printed "Bennet & Bennet" in the statement; this is the company's own spelling.
  { name: "Bennett + Bennett", logo: { src: "/clients/bennett-and-bennett.png", width: 358, height: 40 } },
];
