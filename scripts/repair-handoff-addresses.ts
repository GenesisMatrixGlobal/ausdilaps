/**
 * Re-parse the site address on stored handoffs, and push the correction to Salesforce.
 *
 *   npm run repair:handoff-addresses             (dry run)
 *   npm run repair:handoff-addresses -- --apply
 *
 * The first version put the RAW location into `site_street`, so TW-HTUUT reached the flow as
 * street "City of Stonnington, VIC" with "CITY OF STONNINGTON" again as the city. The parser
 * is fixed (lib/tenders/site-address.ts), but rows already allocated keep the old split — and
 * unlike most of our data these have a second copy in Salesforce that the flow reads, so both
 * have to be corrected or the tool and the flow disagree.
 *
 * Only the four address columns, and only where the parse differs.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { scriptDb } from "./_db";
import { siteAddressFrom } from "../lib/tenders/site-address";
import { updateRecord } from "../lib/salesforce";
import { lookupPostcode } from "../lib/tenders/postcode";

const apply = process.argv.includes("--apply");

async function main() {
  const db = scriptDb();
  const { data, error } = await db
    .from("tender_handoffs")
    .select("code, site_street, site_city, site_state, site_postcode, salesforce_id");
  if (error) throw new Error(error.message);

  // The original location is not stored separately — site_street held it verbatim, which is
  // exactly the bug, so it is also the best input for re-parsing.
  const changes: { row: Record<string, unknown>; next: ReturnType<typeof siteAddressFrom> }[] = [];
  for (const r of data ?? []) {
    const raw = [r.site_street, r.site_city, r.site_state].filter(Boolean).join(", ");
    const parsed = siteAddressFrom((r.site_street as string | null) ?? raw);
    // Fill the postcode for genuine suburbs. Council areas stay blank — see postcode.ts.
    const next = {
      ...parsed,
      postcode:
        (r.site_postcode as string | null) ??
        parsed.postcode ??
        (parsed.isLga ? null : await lookupPostcode(parsed.city, parsed.state)),
    };
    const differs =
      next.street !== r.site_street || next.city !== r.site_city ||
      next.state !== r.site_state || next.postcode !== r.site_postcode;
    if (differs) changes.push({ row: r, next });
  }

  console.log(`${(data ?? []).length} handoff(s), ${changes.length} need correcting\n`);
  for (const c of changes) {
    console.log(`${c.row.code}`);
    console.log(`   was street=${JSON.stringify(c.row.site_street)} city=${JSON.stringify(c.row.site_city)}`);
    console.log(`   now street=${JSON.stringify(c.next.street)} city=${JSON.stringify(c.next.city)} state=${JSON.stringify(c.next.state)} postcode=${JSON.stringify(c.next.postcode)}`);
  }
  if (!apply) { console.log("\n--dry-run: nothing written."); return; }

  for (const c of changes) {
    await db.from("tender_handoffs")
      .update({ site_street: c.next.street, site_city: c.next.city, site_state: c.next.state, site_postcode: c.next.postcode })
      .eq("code", c.row.code);
    if (c.row.salesforce_id) {
      await updateRecord("Tender_Watch_Item__c", c.row.salesforce_id as string, {
        Site_Street__c: c.next.street, Site_City__c: c.next.city,
        Site_State__c: c.next.state, Site_Postcode__c: c.next.postcode,
      });
    }
  }
  console.log(`\nCorrected ${changes.length} in Supabase and Salesforce.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
