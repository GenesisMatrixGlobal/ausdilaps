/**
 * Clients shown in the homepage "Trusted by" logo bar.
 *
 * Only real clients go here — never invent one. Each is sourced below: the
 * site's own portfolio, the FY25/26 Capability Statement case studies, or won
 * opportunities on the account in Salesforce (checked 2026-09-24).
 *
 * Logos are the official files from each client's own website (2026-09-24), in
 * /public/clients. `width`/`height` are the file's own dimensions: the bar sizes
 * every logo to the same visual area from them. A client with no logo shows its
 * name instead. The order is interleaved so similar-looking marks don't bunch.
 */
export type Client = {
  name: string;
  logo?: { src: string; width: number; height: number };
};

export const CLIENTS: Client[] = [
  // Portfolio. TfNSW's own site header carries the NSW Government waratah.
  { name: "Transport for NSW", logo: { src: "/clients/transport-for-nsw.png", width: 259, height: 280 } },
  // Portfolio + Salesforce.
  { name: "Lendlease", logo: { src: "/clients/lendlease.svg", width: 641, height: 181 } },
  // Salesforce. Colours are the ones their own site uses on a light header.
  { name: "Hutchinson Builders", logo: { src: "/clients/hutchinson-builders.svg", width: 300.5, height: 83.7 } },
  // Salesforce (direct, and the WestConnex M4-M5 Link JV).
  { name: "Acciona", logo: { src: "/clients/acciona.svg", width: 126, height: 59 } },
  // Salesforce.
  { name: "CPB Contractors", logo: { src: "/clients/cpb-contractors.png", width: 835, height: 174 } },
  // Salesforce. A one-colour wordmark; their site only carries the white version.
  { name: "Richard Crookes Constructions", logo: { src: "/clients/richard-crookes.svg", width: 200, height: 45 } },
  // Portfolio.
  { name: "Transurban", logo: { src: "/clients/transurban.svg", width: 994, height: 149 } },
  // Salesforce. The orange wordmark from their header, without the white "Australia".
  { name: "Built", logo: { src: "/clients/built.svg", width: 57, height: 24 } },
  // Salesforce.
  { name: "Downer", logo: { src: "/clients/downer.svg", width: 148, height: 41 } },
  // Capability Statement — Glenrowan Solar Farm.
  { name: "UGL", logo: { src: "/clients/ugl.png", width: 600, height: 148 } },
  // Salesforce.
  { name: "ADCO Constructions", logo: { src: "/clients/adco.svg", width: 61.2, height: 66.4 } },
  // Capability Statement — Ipswich Hospital (printed "Bennet & Bennet") + Salesforce.
  { name: "Bennett + Bennett", logo: { src: "/clients/bennett-and-bennett.png", width: 358, height: 40 } },
  // Capability Statement — Main South Road Duplication.
  { name: "Fleurieu Connections Alliance", logo: { src: "/clients/fleurieu-connections-alliance.svg", width: 322, height: 113 } },
];
