"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROOMS, TOTAL_WALLS } from "./house";
import {
  MAX_POSSIBLE_SCORE,
  RUN_SECONDS,
  newGame,
  remainingSeconds,
  roomProgress,
  step,
  summarise,
  type GameState,
  type RunSummary,
} from "./engine";
import { VIEW_H, VIEW_W, draw } from "./render";
import { loadSprites } from "./sprites";

/**
 * Site Snap — walk the house, photograph every wall from the centre of each room.
 *
 * The React layer owns nothing but presentation. All game state lives in a ref and is
 * mutated by engine.step(); React state holds only what a person actually reads, so a
 * 60fps loop doesn't re-render the leaderboard sixty times a second.
 */

type BoardRow = {
  name: string;
  score: number;
  wallsCaptured: number;
  avgQuality: number;
  elapsedMs: number;
  isYou: boolean;
};

type BoardResponse = {
  ok: boolean;
  board?: BoardRow[];
  personalBest?: number;
  newPersonalBest?: boolean;
  error?: string;
};

type Phase = "idle" | "playing" | "over";

const MOVE_KEYS = new Set([
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "w",
  "a",
  "s",
  "d",
  " ",
]);

type Hud = {
  remaining: number;
  captured: number;
  shots: number;
  progress: Array<{ id: string; done: number }>;
};

function emptyHud(): Hud {
  return {
    remaining: RUN_SECONDS,
    captured: 0,
    shots: 0,
    progress: ROOMS.map((r) => ({ id: r.id, done: 0 })),
  };
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function SiteSnapTool() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const frameRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<Hud>(emptyHud);
  // Mirror of `hud`, so the loop can tell whether anything a person can SEE has changed
  // without reading state. Pushing every frame into React re-rendered the leaderboard table
  // sixty times a second to move a clock that only shows whole seconds.
  const hudRef = useRef<Hud>(emptyHud());
  const [result, setResult] = useState<RunSummary | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [beatIt, setBeatIt] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scale, setScale] = useState(1);

  // ── Presentation plumbing ─────────────────────────────────────────────

  useEffect(() => {
    loadSprites();
  }, []);

  /**
   * Integer scaling only.
   *
   * Pixel art at a fractional scale is worse with `image-rendering: pixelated`, not better:
   * nearest-neighbour duplicates some source columns and not others, so strokes come out
   * uneven and the whole image shimmers as things move. Snapping to a whole multiple and
   * wearing the leftover as margin is the only way this looks deliberate.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const avail = wrap.clientWidth;
      setScale(Math.max(1, Math.floor(avail / VIEW_W)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── Leaderboard ───────────────────────────────────────────────────────

  const applyBoard = useCallback((data: BoardResponse) => {
    if (!data.ok) {
      setBoardError(data.error ?? "Could not reach the leaderboard.");
      return;
    }
    setBoardError(null);
    setBoard(data.board ?? []);
    setPersonalBest(data.personalBest ?? 0);
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/site-snap/scores")
      .then((r) => r.json())
      .then((data: BoardResponse) => live && applyBoard(data))
      .catch(() => live && setBoardError("Could not reach the leaderboard."));
    return () => {
      live = false;
    };
  }, [applyBoard]);

  // Submitted from a phase effect, NOT from inside the rAF tick. The run has two end
  // conditions (clock expiry and completion) and submitting from the tick is how you end up
  // firing both.
  useEffect(() => {
    if (phase !== "over" || !result) return;
    let live = true;
    fetch("/api/site-snap/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: Math.min(result.score, MAX_POSSIBLE_SCORE),
        wallsCaptured: result.captured,
        avgQuality: Math.round(result.avgQuality),
        elapsedMs: Math.round(result.elapsed * 1000),
      }),
    })
      .then((r) => r.json())
      .then((data: BoardResponse) => {
        if (!live) return;
        applyBoard(data);
        setBeatIt(data.newPersonalBest === true);
      })
      .catch(() => live && setBoardError("Score not saved — the leaderboard is unreachable."))
      .finally(() => live && setSaving(false));
    return () => {
      live = false;
    };
  }, [phase, result, applyBoard]);

  const start = useCallback(() => {
    loadSprites();
    gameRef.current = newGame();
    keysRef.current.clear();
    pausedRef.current = false;
    setPaused(false);
    setResult(null);
    setBeatIt(false);
    // setSaving here rather than in the submit effect: calling it inside an effect body is a
    // cascading render, and the run is going to be submitted the moment it ends anyway.
    setSaving(true);
    hudRef.current = emptyHud();
    setHud(hudRef.current);
    setPhase("playing");
  }, []);

  // ── Input ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };

    const onDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const key = e.key.toLowerCase();
      if (phase === "playing" && MOVE_KEYS.has(key)) e.preventDefault();
      keysRef.current.add(key);
      if (key === "enter" && phase !== "playing") start();
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    /**
     * Held keys MUST be cleared when the window loses focus. keyup never arrives for a key
     * that was down when you tab away, so the player comes back walking into a wall with no
     * way to stop. Cmd+Tab and Cmd+R both do it.
     */
    const onBlur = () => {
      keysRef.current.clear();
      pausedRef.current = true;
      setPaused(true);
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, start]);

  // ── The loop ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let last = performance.now();

    const tick = (now: number) => {
      // Capped so a frame hitch — or a tab that was throttled — cannot teleport anyone
      // through a wall, and so the run clock never jumps.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const game = gameRef.current;
      if (!game) return;

      if (!pausedRef.current) {
        const keys = keysRef.current;
        game.input.up = keys.has("arrowup") || keys.has("w");
        game.input.down = keys.has("arrowdown") || keys.has("s");
        game.input.left = keys.has("arrowleft") || keys.has("a");
        game.input.right = keys.has("arrowright") || keys.has("d");
        game.input.shutter = keys.has(" ");

        step(game, dt);

        const remaining = Math.ceil(remainingSeconds(game));
        const captured = Object.keys(game.captured).length;
        const prev = hudRef.current;
        if (remaining !== prev.remaining || captured !== prev.captured || game.shots !== prev.shots) {
          hudRef.current = { remaining, captured, shots: game.shots, progress: roomProgress(game) };
          setHud(hudRef.current);
        }
      }

      draw(ctx, game);

      if (game.done) {
        setResult(summarise(game));
        setPhase("over");
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [phase]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
  }, []);

  const low = hud.remaining <= 10;

  return (
    <div className="space-y-6">
      {/* Coarse pointer = no keyboard. Done in CSS rather than with a media-query listener
          in state: it needs no effect, survives SSR, and follows the device if it changes. */}
      <p className="hidden rounded-lg border border-ad-amber-line bg-ad-amber-tint px-4 py-3 text-sm text-ad-ink [@media(pointer:coarse)]:block">
        This one needs a keyboard — open it on a laptop or desktop.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-ad-muted">Time</p>
            <p
              className={`font-heading text-3xl tabular-nums ${low ? "text-ad-orange" : "text-ad-ink"}`}
            >
              {formatTime(hud.remaining)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ad-muted">Walls</p>
            <p className="font-heading text-3xl tabular-nums text-ad-ink">
              {hud.captured}
              <span className="text-lg text-ad-muted">/{TOTAL_WALLS}</span>
            </p>
          </div>
          <div className="hidden sm:block">
            <p className="text-xs uppercase tracking-wide text-ad-muted">Shots</p>
            <p className="font-heading text-3xl tabular-nums text-ad-ink">{hud.shots}</p>
          </div>
        </div>

        {phase === "playing" && (
          <ul className="flex flex-wrap gap-1.5">
            {hud.progress.map((p) => {
              const label = ROOMS.find((r) => r.id === p.id)?.label ?? p.id;
              return (
                <li
                  key={p.id}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    p.done === 4
                      ? "border-transparent bg-ad-steel text-white"
                      : "border-ad-border text-ad-muted"
                  }`}
                >
                  {label} {p.done}/4
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div ref={wrapRef} className="flex justify-center">
        <div className="relative" style={{ width: VIEW_W * scale, height: VIEW_H * scale }}>
          <canvas
            ref={canvasRef}
            width={VIEW_W}
            height={VIEW_H}
            className="block rounded-lg border border-ad-border"
            style={{
              width: VIEW_W * scale,
              height: VIEW_H * scale,
              imageRendering: "pixelated",
            }}
          />

          {phase === "playing" && paused && (
            <Overlay>
              <p className="font-heading text-2xl">Paused</p>
              <p className="max-w-xs text-sm text-white/70">The clock is stopped.</p>
              <Button variant="onDarkAccent" size="sm" onClick={resume}>
                Resume
              </Button>
            </Overlay>
          )}

          {phase === "idle" && (
            <Overlay>
              <p className="font-heading text-2xl">Site Snap</p>
              <div className="max-w-md space-y-1.5 text-sm text-white/75">
                <p>
                  Photograph all {TOTAL_WALLS} walls — four in every room — before the clock
                  runs out.
                </p>
                <p>
                  <b className="text-white">Move</b> WASD or arrows ·{" "}
                  <b className="text-white">Shoot</b> Space
                </p>
                <p>
                  Stand on the marker in the middle of the room and hold still — the camera
                  steadies, and a steady shot scores. Cracked walls are worth double. The
                  clock only pays out if you photograph every wall.
                </p>
                <p className="text-white/60">
                  Watch out: the <b className="text-white">cat</b> hunts you while you stand
                  still and kills your focus, and the{" "}
                  <b className="text-white">toddlers</b> will put you flat on your back if you
                  walk into them. Standing still is safe from toddlers. Moving is safe from
                  the cat. Good luck.
                </p>
              </div>
              <Button variant="onDarkAccent" size="sm" onClick={start}>
                Start survey
              </Button>
            </Overlay>
          )}

          {phase === "over" && result && (
            <Overlay>
              <p className="text-xs uppercase tracking-wide text-white/60">
                {result.complete ? "Survey complete" : "Out of time"}
              </p>
              <p className="font-heading text-5xl tabular-nums">{result.score}</p>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-white/75">
                <dt>Walls</dt>
                <dd className="text-right tabular-nums text-white">
                  {result.captured}/{result.total}
                </dd>
                <dt>Average quality</dt>
                <dd className="text-right tabular-nums text-white">
                  {Math.round(result.avgQuality)}
                </dd>
                <dt>Photo points</dt>
                <dd className="text-right tabular-nums text-white">{result.qualityPoints}</dd>
                <dt>Time bonus</dt>
                <dd className="text-right tabular-nums text-white">
                  {result.complete ? `+${result.timeBonus}` : "forfeited"}
                </dd>
                <dt>Cat interruptions</dt>
                <dd className="text-right tabular-nums text-white">{result.tangles}</dd>
                <dt>Times floored</dt>
                <dd className="text-right tabular-nums text-white">{result.trips}</dd>
              </dl>
              {!result.complete && (
                <p className="max-w-xs text-xs text-white/60">
                  A survey with a wall missing earns no time bonus — same as the real thing.
                </p>
              )}
              <p className="text-sm text-white/70">
                {saving ? "Saving…" : beatIt ? "New personal best." : `Your best is ${personalBest}.`}
              </p>
              <Button variant="onDarkAccent" size="sm" onClick={start}>
                Go again
              </Button>
            </Overlay>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-ad-border bg-ad-surface p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ad-ink">Leaderboard</h3>
          <p className="text-xs text-ad-muted">Best run per person</p>
        </div>

        {boardError ? (
          <p className="mt-3 text-sm text-ad-muted">{boardError}</p>
        ) : board.length === 0 ? (
          <p className="mt-3 text-sm text-ad-muted">No runs yet. Go first.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ad-muted">
                <th className="w-8 font-medium">#</th>
                <th className="font-medium">Name</th>
                <th className="w-20 text-right font-medium">Score</th>
                <th className="w-16 text-right font-medium">Walls</th>
                <th className="w-20 text-right font-medium">Quality</th>
                <th className="w-16 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row, i) => (
                <tr
                  key={`${row.name}-${i}`}
                  className={row.isYou ? "font-semibold text-ad-ink" : "text-ad-muted"}
                >
                  <td className="py-1 tabular-nums">{i + 1}</td>
                  <td className="truncate py-1">{row.name}</td>
                  <td className="py-1 text-right tabular-nums text-ad-ink">{row.score}</td>
                  <td className="py-1 text-right tabular-nums">{row.wallsCaptured}</td>
                  <td className="py-1 text-right tabular-nums">{row.avgQuality}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatTime(row.elapsedMs / 1000)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-ad-navy-deep/88 p-6 text-center text-white">
      {children}
    </div>
  );
}
