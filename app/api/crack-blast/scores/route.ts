import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { getStaffUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordToolUse } from "@/lib/tools/usage";
import { MAX_POINTS_PER_LINE, MAX_POINTS_PER_MOVE } from "@/components/tools/crack-blast/rules";

/**
 * CrackBlast leaderboard — read the board, post a run. Same arrangement as Site Snap's:
 * name and id come from the session, only the numbers are self-reported, and only a
 * personal best is ever written.
 */

export const runtime = "nodejs";

const TOOL_SLUG = "crack-blast";
const TABLE = "crack_blast_scores";
const BOARD_SIZE = 20;

const submitSchema = z
  .object({
    score: z.number().int().min(0).max(50_000_000),
    lines: z.number().int().min(0).max(1_000_000),
    bestCombo: z.number().int().min(0).max(100_000),
    wall: z.number().int().min(1).max(100_000),
    moves: z.number().int().min(0).max(1_000_000),
    durationMs: z.number().int().min(0).max(24 * 3_600_000),
  })
  // A browser game can't be verified, but it can be bounded: every point comes from a
  // placed cell or a cleared line, so a score past those ceilings was not played.
  .refine((r) => r.score <= r.moves * MAX_POINTS_PER_MOVE + r.lines * MAX_POINTS_PER_LINE);

export type CrackBlastRow = {
  name: string;
  score: number;
  lines: number;
  bestCombo: number;
  wall: number;
  isYou: boolean;
};

const COLUMNS = "user_id, player_name, score, lines_cleared, best_combo, wall_reached";

async function loadBoard(userId: string): Promise<CrackBlastRow[]> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select(COLUMNS)
    .order("score", { ascending: false })
    .order("played_at", { ascending: true })
    .limit(BOARD_SIZE);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    name: r.player_name as string,
    score: r.score as number,
    lines: (r.lines_cleared as number) ?? 0,
    bestCombo: (r.best_combo as number) ?? 0,
    wall: (r.wall_reached as number) ?? 1,
    isYou: r.user_id === userId,
  }));
}

/** The caller's best and where it ranks — it may sit below the top twenty. */
async function loadPersonal(userId: string): Promise<{ best: number; rank: number | null }> {
  const db = createAdminClient();
  const { data, error } = await db.from(TABLE).select("score").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const best = (data?.score as number | undefined) ?? 0;
  if (!data) return { best, rank: null };
  const { count } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .gt("score", best);
  return { best, rank: (count ?? 0) + 1 };
}

async function respond(userId: string, extra: Record<string, unknown> = {}) {
  const [board, personal] = await Promise.all([loadBoard(userId), loadPersonal(userId)]);
  return NextResponse.json({
    ok: true,
    board,
    personalBest: personal.best,
    rank: personal.rank,
    ...extra,
  });
}

export async function GET() {
  const user = await getStaffUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  try {
    return await respond(user.id);
  } catch (e) {
    console.error("[crack-blast] board read failed:", (e as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not load the leaderboard." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getStaffUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  after(() => recordToolUse(TOOL_SLUG, user.id));

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

  const run = parsed.data;
  const name = user.fullName?.trim() || user.email.split("@")[0];

  try {
    const { best: previous } = await loadPersonal(user.id);
    const beaten = run.score > previous;
    if (beaten) {
      const { error } = await createAdminClient()
        .from(TABLE)
        .upsert(
          {
            user_id: user.id,
            player_name: name,
            score: run.score,
            lines_cleared: run.lines,
            best_combo: run.bestCombo,
            wall_reached: run.wall,
            moves: run.moves,
            duration_ms: run.durationMs,
            played_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      if (error) throw new Error(error.message);
    }
    return await respond(user.id, { newPersonalBest: beaten });
  } catch (e) {
    console.error("[crack-blast] run submit failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not save your run." }, { status: 500 });
  }
}
