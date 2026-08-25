/**
 * What counts as a tender worth our time.
 *
 * Lives in code, not the database: it will be tuned weekly for the first month and then
 * almost never, and a PR diff is better review than an admin form — plus it saves a table,
 * a route and ~200 lines of UI.
 *
 * Scoped to CORE SERVICES ONLY, deliberately. Not drone/LiDAR capture on its own, not
 * "large civil job we could sub-contract into", not standing-offer panels unless they
 * name condition assessment. Precision over recall for v1 — a digest people trust beats a
 * digest people stop opening. Widen it once a month of real output has been read.
 *
 * Service definitions are the four in SERVICES (lib/site.ts).
 */

export const SERVICE_KEYS = [
  "dilapidation",
  "condition-survey",
  "sia",
  "doa",
  "dca",
] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  dilapidation: "Dilapidation",
  "condition-survey": "Condition survey",
  sia: "Structural Integrity Assessment",
  doa: "Defect Origin Assessment",
  dca: "Defect Comparison Assessment",
};

export const MATCH_PROFILE = `AusDilaps is an Australian specialist building-inspection and engineering
consultancy. It is the country's specialist in dilapidation (building condition) reporting, works
Australia-wide for Tier-1 contractors and government agencies, and reports to AS 4349.0.

The four services to match against:

- dilapidation — Pre- and post-construction property condition reports that document existing
  conditions and give a defensible baseline for damage claims. Residential, commercial and
  infrastructure. This is the flagship; most real matches name it directly.
- condition-survey — Building or asset condition surveys and inspections carried out to establish
  or record physical condition, including road and corridor condition surveys.
- sia — Structural Integrity Assessment. Evaluating structural performance and stability, and
  identifying weaknesses or potential failures.
- doa — Defect Origin Assessment. Investigating the root cause of a defect with evidence-based
  reporting, to support remediation, dispute resolution and liability.
- dca — Defect Comparison Assessment. Comparing pre- and post-construction conditions to identify
  change and construction impact, supporting claims management.

Capture methods that often appear alongside the above and reinforce a match, but which are NOT a
match on their own: high-resolution photography, roadway video survey, drone survey, LiDAR, point
cloud / 3D model, culvert and pipe inspection, GPS-georeferenced imagery.

Verdict guidance:

- "match" — the notice asks for one or more of the five services above as a deliverable. Typical
  signals: dilapidation surveys of adjoining or nearby properties, pre-construction condition
  recording ahead of tunnelling / piling / blasting / road works, defect cause investigation,
  pre-and-post comparison reporting.
- "maybe" — plausibly in scope but the document is too thin, too generic, or ambiguous about
  whether the work is construction-impact condition reporting or something adjacent (routine
  asset-management inspection, a building surveyor / certifier role, a general engineering panel).
  Standing-offer panels naming condition assessment belong here: recurring revenue, but a
  judgement call. Use "maybe" freely — a human reads every one.
- "no_match" — no service above is sought. Common near-misses that are NOT matches: traffic
  control and traffic management, general construction or civil works where we would be the
  builder, asbestos or hazmat surveys, energy ratings (BASIX / NatHERS) on their own, quantity
  surveying, building certification, cleaning, maintenance, labour hire, goods supply.

Geography: Australia only. A tender outside Australia is never a match.`;
