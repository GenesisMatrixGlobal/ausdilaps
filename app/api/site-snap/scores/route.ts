import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { getStaffUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordToolUse } from "@/lib/tools/usage";
import { MAX_POSSIBLE_SCORE } from "@/components/tools/site-snap/engine";
import { TOTAL_WALLS } from "@/components/tools/site-snap/house";

/**
 * Site Snap leaderboard — read the board, post a run.
 *
 * The player never supplies their name or id: both come from the session, so the only thing
 * a client can influence is the numbers. Those are still self-reported — it is a browser
 * game and there is no server-side simulation to check them against — which is precisely why
 * this lives in its own table, well away from anything that matters.
 */

export const runtime = "nodejs";

const TOOL_SLUG = "site-snap";
const BOARD_SIZE = 10;

const submitSchema = z.object({
  score: z.number().int().min(0).max(MAX_POSSIBLE_SCORE),
  wallsCaptured: z.number().int().min(0).max(TOTAL_WALLS),
  avgQuality: z.number().int().min(0).max(100),
  elapsedMs: z.number().int().min(0).max(10 * 60_000),
});

type BoardRow = {
  name: string;
  score: number;
  wallsCaptured: number;
  avgQuality: number;
  elapsedMs: number;
  isYou: boolean;
};

const COLUMNS = "user_id, player_name, score, walls_captured, avg_quality, elapsed_ms";

async function loadBoard(userId: string): Promise<BoardRow[]> {
  const { data, error } = await createAdminClient()
    .from("site_snap_scores")
    .select(COLUMNS)
    // Ties are likely on a fixed house with integer scores — the faster run wins.
    .order("score", { ascending: false })
    .order("elapsed_ms", { ascending: true })
    .limit(BOARD_SIZE);

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    name: r.player_name as string,
    score: r.score as number,
    wallsCaptured: (r.walls_captured as number) ?? 0,
    avgQuality: (r.avg_quality as number) ?? 0,
    elapsedMs: (r.elapsed_ms as number) ?? 0,
    isYou: r.user_id === userId,
  }));
}

/** The caller's own best, which may sit below the top ten. */
async function loadPersonalBest(userId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("site_snap_scores")
    .select("score")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.score as number | undefined) ?? 0;
}

export async function GET() {
  const user = await getStaffUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  try {
    const [board, personalBest] = await Promise.all([
      loadBoard(user.id),
      loadPersonalBest(user.id),
    ]);
    return NextResponse.json({ ok: true, board, personalBest });
  } catch (e) {
    console.error("[site-snap] board read failed:", (e as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not load the leaderboard." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getStaffUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  after(() => recordToolUse(TOOL_SLUG));

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid run." }, { status: 400 });
  }

  const { score, wallsCaptured, avgQuality, elapsedMs } = parsed.data;
  const name = user.fullName?.trim() || user.email.split("@")[0];

  try {
    const previous = await loadPersonalBest(user.id);

    // Only a personal best is written. Storing every run would make the unique index
    // pointless and the board a scroll of one person's afternoon.
    const beaten = score > previous;
    if (beaten) {
      const { error } = await createAdminClient()
        .from("site_snap_scores")
        .upsert(
          {
            user_id: user.id,
            player_name: name,
            score,
            walls_captured: wallsCaptured,
            avg_quality: avgQuality,
            elapsed_ms: elapsedMs,
            played_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      if (error) throw new Error(error.message);
    }

    const board = await loadBoard(user.id);
    return NextResponse.json({
      ok: true,
      board,
      personalBest: Math.max(previous, score),
      newPersonalBest: beaten,
    });
  } catch (e) {
    console.error("[site-snap] run submit failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not save your run." }, { status: 500 });
  }
}
