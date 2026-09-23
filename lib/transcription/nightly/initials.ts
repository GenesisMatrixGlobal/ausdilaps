// Pure: which inspector an uploads folder belongs to. Pinned by check:transcript.
//
// Each day folder holds one folder per inspector, named with their initials — first and last
// name ("MW" = Martin (Jie) Weng). The names and work emails come from Salesforce's Staff__c
// (Inspector Team, currently employed), read once a night. Two current inspectors sharing
// initials would make a folder AMBIGUOUS, and an ambiguous or unknown folder is reported and
// never emailed: a "you're missing a recording" email to the wrong inspector is worse than none.

export type StaffMember = { name: string; email: string | null };

export type InspectorMatch =
  | { kind: "match"; initials: string; name: string; email: string | null }
  | { kind: "ambiguous"; initials: string; names: string[] }
  | { kind: "unknown"; initials: string };

/** "Martin (Jie) Weng" → "MW". The bracketed nickname is dropped; first and last word count. */
export function initialsOf(fullName: string): string {
  const words = fullName
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The initials a folder is named with: "MW", "mw", "M.W." and "M W" are all MW; a longer name
 *  ("MW - Martin") is read from its first word. */
export function folderInitials(folderName: string): string {
  const letters = folderName.replace(/[^A-Za-z]/g, "");
  if (letters.length <= 3) return letters.toUpperCase();
  const first = folderName.trim().split(/[\s\-_]+/)[0].replace(/[^A-Za-z]/g, "");
  return first.length >= 2 && first.length <= 3 ? first.toUpperCase() : "";
}

function normaliseName(s: string): string {
  return s.replace(/\([^)]*\)/g, " ").toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

export function matchInspector(folderName: string, staff: StaffMember[]): InspectorMatch {
  // A folder named with the whole name wins outright.
  const byName = staff.filter((s) => normaliseName(s.name) === normaliseName(folderName));
  if (byName.length === 1) return { kind: "match", initials: initialsOf(byName[0].name), name: byName[0].name, email: byName[0].email };

  const initials = folderInitials(folderName);
  if (!initials) return { kind: "unknown", initials: folderName.trim() };
  const hits = staff.filter((s) => initialsOf(s.name) === initials);
  if (hits.length === 1) return { kind: "match", initials, name: hits[0].name, email: hits[0].email };
  if (hits.length > 1) return { kind: "ambiguous", initials, names: hits.map((h) => h.name) };
  return { kind: "unknown", initials };
}
