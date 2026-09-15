// The storeys check's VOTING rules, pinned down. Pure — no keys, no network.
//   npm run check:storeys
import { combinedConfidence, tallyVerdicts } from "@/lib/storeys/street-view-storeys";

let failures = 0;
function eq<T>(actual: T, want: T, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(want)) {
    failures++;
    console.error(`✗ ${what}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
  }
}
const v = (storeys: number | null, confidence: number, facadeVisible = true) => ({ storeys, confidence, facadeVisible, buildingType: "house", notes: "" });

// Evidence accumulates: agreeing views reinforce, they are not averaged.
eq(combinedConfidence([62, 68]), 88, "62 & 68 → 88");
eq(combinedConfidence([55, 55, 55]), 91, "three at 55 → 91");
eq(combinedConfidence([50, 50]), 75, "two at 50 → 75");
eq(combinedConfidence([70]), 70, "one photo keeps its own number");

// Two agreeing angles → clear, with the combined number.
let t = tallyVerdicts([v(2, 60), v(2, 80)], 4);
eq([t.clear, t.storeys, t.confidence], [true, 2, 92], "two agreeing angles clear with accumulated confidence");

// Row 1 of the residential trial: two clear views of one storey plus three blind guesses.
t = tallyVerdicts([v(1, 70, false), v(1, 65), v(1, 30, false), v(1, 62), v(1, 25, false)], 5);
eq([t.clear, t.confidence], [true, 87], "blind photos neither help nor hurt; the two that saw it clear it");

// One confident angle alone, more cameras available → not yet; wants another.
t = tallyVerdicts([v(1, 85)], 3);
eq([t.clear, t.wantsMore], [false, true], "a lone confident angle waits for corroboration");

// The only camera the property has, very confident → clear.
t = tallyVerdicts([v(1, 90)], 1);
eq([t.clear, t.reason], [true, "one camera only, but a clear view"], "a lone camera clears at 85+");
t = tallyVerdicts([v(1, 72)], 1);
eq(t.clear, false, "a lone camera at 72 stays highlighted");

// Two confident angles that disagree → no clear, but worth another angle while cameras remain…
t = tallyVerdicts([v(1, 80), v(2, 85)], 5);
eq([t.clear, t.wantsMore], [false, true], "a disagreement asks for a tiebreaker");
// …and blocked for good once the cameras are exhausted.
t = tallyVerdicts([v(1, 80), v(2, 85)], 2);
eq([t.clear, t.wantsMore, t.reason], [false, false, "nearest camera says 1, others 2"], "confident disagreement blocks a clear when exhausted — the nearest camera's view is the reason given");

// Three facade-visible agreeing angles at ~60 clear with none confident (combined 94).
t = tallyVerdicts([v(1, 60), v(1, 62), v(1, 58)], 5);
eq([t.clear, t.reason], [true, "3 angles agree"], "three agreeing angles clear without a confident one");
// Two at 50 (combined 75) do not.
t = tallyVerdicts([v(1, 50), v(1, 50)], 2);
eq([t.clear, t.reason], [false, "agreeing angles, combined 75% — not enough"], "two weak agreements fall short");

// A lone weak dissent is outvoted 3–1 when the nearest camera is in the majority.
t = tallyVerdicts([v(1, 70), v(1, 65), v(2, 55), v(1, 60)], 4);
eq([t.clear, t.reason], [true, "3 angles agree, one outvoted"], "one weak dissent loses to three agreeing angles");
t = tallyVerdicts([v(1, 70), v(1, 65), v(2, 75), v(1, 60)], 4);
eq(t.clear, false, "a confident dissent is never outvoted");

// Weighted majority: two quiet 1s outweigh one loud 2 for the GUESS, but the loud 2 is a dissent, so no clear.
t = tallyVerdicts([v(1, 60), v(1, 65), v(2, 80)], 3);
eq([t.storeys, t.clear], [1, false], "two quiet agreeing angles win the guess; a confident outlier can't clear against them");

// The vet: nearest camera says 2 @ 60, three others say 1 @ 70/55/50 → the nearest camera vetoes.
t = tallyVerdicts([v(2, 60), v(1, 70), v(1, 55), v(1, 50)], 4);
eq([t.clear, t.reason], [false, "nearest camera says 2, others 1"], "the vet stays highlighted");
// The same dissent from a farther camera, cameras exhausted → a real disagreement.
t = tallyVerdicts([v(1, 70), v(2, 60), v(1, 55)], 3);
eq([t.clear, t.reason], [false, "angles disagree (1 vs 2)"], "a dissent at 50+ from a farther camera still blocks two agreeing angles");
// …but a dissent below 50 is noise.
t = tallyVerdicts([v(1, 75), v(2, 40), v(1, 65)], 3);
eq(t.clear, true, "a dissent under 50 from a farther camera doesn't block");

// The nearest camera's veto: it says 2 at 45 (below the dissent line), three far ones say 1 → no clear.
t = tallyVerdicts([v(2, 45), v(1, 75), v(1, 70), v(1, 65)], 4);
eq([t.clear, t.reason], [false, "nearest camera says 2, others 1"], "the nearest camera cannot be outvoted");
// …unless it didn't see the facade, or barely had an opinion.
t = tallyVerdicts([v(2, 45, false), v(1, 75), v(1, 70)], 3);
eq(t.clear, true, "a nearest camera that couldn't see the facade has no veto");
t = tallyVerdicts([v(2, 30), v(1, 75), v(1, 70)], 3);
eq(t.clear, true, "a nearest camera under 40 has no veto");

// Facade hidden can't corroborate; mean floor.
t = tallyVerdicts([v(1, 80), v(1, 60, false)], 2);
eq([t.clear, t.reason], [false, "agreeing angles, but the facade was not clearly in view"], "a facade-hidden angle can't vouch");
t = tallyVerdicts([v(1, 60), v(1, 40)], 2);
eq([t.clear, t.reason], [false, "agreeing angles, combined 76% — not enough"], "a strong and a weak agreement fall just short");

// Vacant / unreadable abstain.
t = tallyVerdicts([v(null, 90), v(1, 75), v(1, 60)], 3);
eq([t.clear, t.storeys], [true, 1], "a null verdict neither votes nor conflicts");
t = tallyVerdicts([v(null, 90), v(null, 20)], 2);
eq([t.clear, t.storeys, t.wantsMore], [false, null, false], "nothing countable → highlighted, exhausted");

// Exhausted without corroboration → highlighted with a reason.
t = tallyVerdicts([v(2, 60), v(1, 55)], 2);
eq([t.clear, t.reason], [false, "angles disagree (2 vs 1)"], "split with no confidence stays highlighted");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ storeys voting rules behave as agreed");
