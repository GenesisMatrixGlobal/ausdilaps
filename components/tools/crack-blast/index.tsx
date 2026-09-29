"use client";

import "./crack-blast.css";
import { Component, createRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Caprasimo, Figtree } from "next/font/google";
import {
  Maximize2,
  Minimize2,
  Music,
  Pause,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  COMBO_GRACE,
  N,
  POINTS_PER_CELL,
  clearPoints,
  deal,
  findLines,
  fits,
  fitsAny,
  type Grid,
  type Line,
  type Piece,
} from "./rules";
import { HOT, KEYS, NT, PROG, THEMES, TX, clamp, fmt, mf, rnd, type Theme } from "./themes";

/**
 * CrackBlast — "An AusDilaps Challenge". A block puzzle where every finished row or column
 * cracks and shatters. Ported from the CrackBlast v2.0 design build (a class component in a
 * template runtime that loaded React and Babel from a CDN at runtime) into a plain React
 * class, with a staff-wide leaderboard added (`/api/crack-blast/scores`, migration 0026).
 *
 * Changes from the design build, all deliberate:
 *  - The board is fixed at 8x8 and the design-tool settings (grid size, start wall, line
 *    preview, intensity) are gone — one leaderboard needs one game.
 *  - It runs inside a tool page, so it is a panel rather than the whole viewport; the
 *    expand button takes it full screen, which is how it was designed to be played.
 *  - Restart moved off the header into the pause menu, making room for that button and a
 *    leaderboard button.
 *  - A run is posted when it ends — game over, or a restart with points on the board.
 */

const caprasimo = Caprasimo({ weight: "400", subsets: ["latin"], variable: "--font-caprasimo" });
const figtree = Figtree({ weight: ["400", "600", "700"], subsets: ["latin"], variable: "--font-figtree" });
const LABEL_FONT = caprasimo.style.fontFamily;

const INTENSITY = 1.15;
const BEST_KEY = "crackblast.best.v2";
const ICON = { size: 17, strokeWidth: 2.75 } as const;

type BoardRow = { name: string; score: number; lines: number; bestCombo: number; wall: number; isYou: boolean };
type BoardResponse = {
  ok: boolean;
  board?: BoardRow[];
  personalBest?: number;
  rank?: number | null;
  newPersonalBest?: boolean;
  error?: string;
};

type Drag = { i: number; x: number; y: number; r: number; c: number; ok: boolean; cs: number; gap: number };

type State = {
  grid: Grid;
  pieces: (Piece | null)[];
  score: number;
  best: number;
  bestAtStart: number;
  celebrated: boolean;
  combo: number;
  miss: number;
  bestCombo: number;
  lines: number;
  moves: number;
  over: boolean;
  paused: boolean;
  music: boolean;
  sfx: boolean;
  drag: Drag | null;
  toast: string | null;
  expanded: boolean;
  boardOpen: boolean;
  board: BoardRow[];
  rank: number | null;
  boardError: string | null;
  saving: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };
type Poly = { pts: [number, number][]; cum: number[]; total: number; f0?: number };
type CrackGeo = { sides: Poly[]; branches: Poly[]; row: boolean; center: [number, number]; half: number };
type Frag = { x: number; y: number; pts: [number, number][]; vx: number; vy: number; rot: number; vr: number; age: number; life: number; fill: string; edge: string };
type Dust = { x: number; y: number; vx: number; vy: number; r: number; g: number; age: number; life: number; col: string };
type Ball = { hx: number; hy: number; px: number; py: number; L: number; R: number; t0: number; swing: number };
type BoardBox = { x: number; y: number; w: number; h: number; cx: number; cy: number };

type ClearEffect = {
  kind: "clear";
  t0: number;
  last: number;
  T: { impact: number; crack: number; fail: number };
  k: number;
  n: number;
  geo: CrackGeo[];
  cleared: number[];
  rects: Record<number, Rect>;
  colors: Record<number, { base: string; dark: string }>;
  owner: Record<number, number>;
  els: HTMLElement[];
  removed: boolean;
  frags: Frag[];
  dust: Dust[];
  bb: BoardBox;
  main: string | null;
  second: string;
  ball: Ball | null;
  crack: string;
  label: [string, string];
  dcols: string[];
  hit?: boolean;
  kick?: number;
  kickA?: number;
  kickDone?: number;
};
type BestEffect = {
  kind: "best";
  t0: number;
  last: number;
  bb: BoardBox;
  bits: { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; fill: string }[];
  label: [string, string];
};
type Effect = ClearEffect | BestEffect;

function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function loadFlag(k: string): boolean {
  try {
    return localStorage.getItem("crackblast." + k) !== "0";
  } catch {
    return true;
  }
}
function saveFlag(k: string, v: boolean) {
  try {
    localStorage.setItem("crackblast." + k, v ? "1" : "0");
  } catch {}
}
const vibrate = (ms: number) => {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
};

const wallNo = (score: number) => Math.floor(score / 1000) + 1;
const themeIdx = (score: number) => (wallNo(score) - 1) % NT;
const bgOf = (ci: number, th: Theme) => {
  const b = th.blocks[ci % 5];
  return `${TX[b[2]]}, ${b[0]}`;
};

export function CrackBlastTool() {
  return <CrackBlast />;
}

class CrackBlast extends Component<object, State> {
  rootRef = createRef<HTMLDivElement>();
  gridRef = createRef<HTMLDivElement>();
  canvasRef = createRef<HTMLCanvasElement>();
  frameRef = createRef<HTMLDivElement>();
  wallRef = createRef<HTMLDivElement>();
  bestRef = createRef<HTMLDivElement>();
  comboRef = createRef<HTMLDivElement>();
  trayRef = createRef<HTMLDivElement>();

  effects: Effect[] = [];
  busy = 0;
  pending: { i: number; r: number; c: number } | null = null;
  dm: { i: number; touch: boolean; ox: number; oy: number; cs: number; pitch: number } | null = null;
  raf: number | null = null;
  tt: ReturnType<typeof setTimeout> | undefined;
  ctx: CanvasRenderingContext2D | null = null;
  cw = 0;
  ch = 0;
  runStart = 0;
  submitted = false;
  ro: ResizeObserver | null = null;

  ac: AudioContext | null = null;
  noiseBuf: AudioBuffer | null = null;
  master: GainNode | null = null;
  sfxG: GainNode | null = null;
  musG: GainNode | null = null;
  mTimer: ReturnType<typeof setInterval> | null = null;
  mStep = 0;
  mNext = 0;

  // Server-rendered with an empty grid and no deal: Math.random() in the first render would
  // hand the client a different tray from the server's and fail hydration.
  state: State = {
    grid: Array(N * N).fill(null),
    pieces: [null, null, null],
    score: 0,
    best: 0,
    bestAtStart: 0,
    celebrated: false,
    combo: 0,
    miss: 0,
    bestCombo: 0,
    lines: 0,
    moves: 0,
    over: false,
    paused: false,
    music: true,
    sfx: true,
    drag: null,
    toast: null,
    expanded: false,
    boardOpen: false,
    board: [],
    rank: null,
    boardError: null,
    saving: false,
  };

  fresh(): Pick<State, "grid" | "pieces" | "score" | "bestAtStart" | "celebrated" | "combo" | "miss" | "bestCombo" | "lines" | "moves" | "over" | "paused" | "drag"> {
    const grid: Grid = Array(N * N).fill(null);
    this.runStart = Date.now();
    this.submitted = false;
    return {
      grid,
      pieces: deal(grid),
      score: 0,
      bestAtStart: this.state.best,
      celebrated: false,
      combo: 0,
      miss: 0,
      bestCombo: 0,
      lines: 0,
      moves: 0,
      over: false,
      paused: false,
      drag: null,
    };
  }

  theme(): Theme {
    return THEMES[themeIdx(this.state.score)];
  }

  cellEls(): HTMLElement[] {
    return this.gridRef.current ? Array.from(this.gridRef.current.querySelectorAll<HTMLElement>("[data-i]")) : [];
  }
  bump(el: HTMLElement | null, s = 1.12) {
    el?.animate?.([{ transform: "scale(1)" }, { transform: `scale(${s})` }, { transform: "scale(1)" }], {
      duration: 320,
      easing: "cubic-bezier(.3,1.6,.5,1)",
    });
  }
  showToast(msg: string, ms = 2200) {
    clearTimeout(this.tt);
    this.setState({ toast: msg });
    this.tt = setTimeout(() => this.setState({ toast: null }), ms);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  componentDidMount() {
    const best = loadNumber(BEST_KEY);
    this.setState({ ...this.fresh(), best, bestAtStart: best, music: loadFlag("music"), sfx: loadFlag("sfx") });
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onHide);
    // The Tools/Training tabs keep this mounted but hidden; a zero-size root means the pane
    // was switched away, and the music should not play on under the training page.
    if (this.rootRef.current) {
      this.ro = new ResizeObserver(([e]) => {
        if (e.contentRect.width === 0) this.autoPause();
      });
      this.ro.observe(this.rootRef.current);
    }
    this.loadBoard();
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onHide);
    this.ro?.disconnect();
    this.unbind();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.stopMusic();
    clearTimeout(this.tt);
    document.body.style.overflow = "";
    this.ac?.close().catch(() => {});
  }

  componentDidUpdate(_: object, ps: State) {
    if (Math.floor(this.state.score / 1000) > Math.floor(ps.score / 1000)) this.levelUp();
    if (this.state.combo > ps.combo) this.bump(this.comboRef.current, 1.18);
    if (this.state.expanded !== ps.expanded) document.body.style.overflow = this.state.expanded ? "hidden" : "";
    if (this.state.over && !ps.over) this.submitRun();
    this.syncMusic();
  }

  onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (this.state.boardOpen) return this.setState({ boardOpen: false });
    this.setState((s) => ({ paused: !s.paused && !s.over }));
  };
  onHide = () => {
    if (document.hidden) this.autoPause();
  };
  autoPause() {
    if (!this.state.over && !this.state.paused && this.state.moves > 0) this.setState({ paused: true });
    else this.stopMusic();
  }

  levelUp() {
    const th = this.theme();
    this.sfxFanfare();
    this.bump(this.wallRef.current, 1.06);
    [this.gridRef.current, this.trayRef.current].forEach((el) =>
      el?.animate?.([{ filter: "brightness(1.5) saturate(.4)" }, { filter: "none" }], { duration: 1100, easing: "ease-out" })
    );
    this.showToast(`Wall ${wallNo(this.state.score)} unlocked: ${th.name}`, 2600);
  }

  // ── leaderboard ────────────────────────────────────────────────────────

  applyBoard(data: BoardResponse) {
    if (!data.ok) return this.setState({ boardError: data.error ?? "Could not reach the leaderboard." });
    const serverBest = data.personalBest ?? 0;
    this.setState((s) => ({
      boardError: null,
      board: data.board ?? [],
      rank: data.rank ?? null,
      // The server's best follows the player between devices; the local one covers a run
      // the server never heard about.
      best: Math.max(s.best, serverBest),
      bestAtStart: s.moves === 0 ? Math.max(s.bestAtStart, serverBest) : s.bestAtStart,
    }));
  }

  loadBoard() {
    fetch("/api/crack-blast/scores")
      .then((r) => r.json())
      .then((d: BoardResponse) => this.applyBoard(d))
      .catch(() => this.setState({ boardError: "Could not reach the leaderboard." }));
  }

  submitRun() {
    const s = this.state;
    if (this.submitted || s.score <= 0) return;
    this.submitted = true;
    this.setState({ saving: true });
    fetch("/api/crack-blast/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: s.score,
        lines: s.lines,
        bestCombo: s.bestCombo,
        wall: wallNo(s.score),
        moves: s.moves,
        durationMs: Math.max(0, Date.now() - this.runStart),
      }),
    })
      .then((r) => r.json())
      .then((d: BoardResponse) => this.applyBoard(d))
      .catch(() => this.setState({ boardError: "Score not saved — the leaderboard is unreachable." }))
      .finally(() => this.setState({ saving: false }));
  }

  // ── drag ───────────────────────────────────────────────────────────────

  startDrag(i: number, e: ReactPointerEvent) {
    const s = this.state;
    if (s.over || s.paused || !s.pieces[i]) return;
    e.preventDefault();
    this.ensureAudio();
    const els = this.cellEls();
    if (els.length < 2) return;
    const a = els[0].getBoundingClientRect(), b = els[1].getBoundingClientRect();
    this.dm = { i, touch: e.pointerType !== "mouse", ox: a.left, oy: a.top, cs: a.width, pitch: b.left - a.left };
    this.updateDrag(e.clientX, e.clientY);
    this.unbind();
    window.addEventListener("pointermove", this.onMove, { passive: false });
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }
  unbind() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
  }
  onMove = (e: PointerEvent) => {
    if (!this.dm) return;
    e.preventDefault();
    this.updateDrag(e.clientX, e.clientY);
  };
  updateDrag(px: number, py: number) {
    if (!this.dm) return;
    const { i, touch, ox, oy, cs, pitch } = this.dm, p = this.state.pieces[i];
    if (!p) return;
    const w = p.w * pitch - (pitch - cs), h = p.h * pitch - (pitch - cs);
    const x = px - w / 2, y = touch ? py - h - Math.max(48, cs * 1.2) : py - h / 2;
    const c = Math.round((x - ox) / pitch), r = Math.round((y - oy) / pitch);
    const ok = fits(this.state.grid, p.shape, r, c);
    const d = this.state.drag;
    if (d && d.x === x && d.y === y) return;
    this.setState({ drag: { i, x, y, r, c, ok, cs, gap: pitch - cs } });
  }
  onUp = () => {
    this.unbind();
    const d = this.state.drag;
    this.dm = null;
    this.setState({ drag: null });
    if (d && d.ok) {
      if (this.busy) this.pending = { i: d.i, r: d.r, c: d.c };
      else this.place(d.i, d.r, d.c);
    }
  };

  // ── game ───────────────────────────────────────────────────────────────

  place(i: number, r: number, c: number) {
    const s = this.state, p = s.pieces[i];
    if (!p || !fits(s.grid, p.shape, r, c)) return;
    const g = s.grid.slice(), placed: number[] = [];
    p.shape.forEach(([a, b]) => {
      const k = (r + a) * N + c + b;
      g[k] = p.color;
      placed.push(k);
    });
    const lines = findLines(g), n = lines.length;
    const gc = g.slice();
    lines.forEach((l) => l.cells.forEach((k) => (gc[k] = null)));
    let pcs = s.pieces.slice();
    pcs[i] = null;
    if (pcs.every((x) => !x)) pcs = deal(gc);
    let combo = s.combo, miss = s.miss, broke = false;
    if (n) {
      combo += 1;
      miss = 0;
    } else if (combo) {
      miss += 1;
      if (miss >= COMBO_GRACE) {
        broke = combo >= 2;
        combo = 0;
        miss = 0;
      }
    }
    const clearPts = clearPoints(n, combo);
    const score = s.score + p.shape.length * POINTS_PER_CELL + clearPts;
    const best = Math.max(s.best, score);
    if (best > s.best) {
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch {}
    }
    const celebrate = !s.celebrated && s.bestAtStart > 0 && score > s.bestAtStart;
    this.setState(
      {
        grid: g,
        pieces: pcs,
        score,
        best,
        combo,
        miss,
        bestCombo: Math.max(s.bestCombo, combo),
        lines: s.lines + n,
        moves: s.moves + 1,
        celebrated: s.celebrated || celebrate,
      },
      () => {
        this.pop(placed);
        this.sfxPlace();
        vibrate(8);
        if (broke) this.sfxFizzle();
        if (n) this.startClear(lines, combo, clearPts);
        else this.checkOver();
        if (celebrate) setTimeout(() => this.celebrate(), n ? (n >= 3 ? 1300 : 850) : 0);
      }
    );
  }
  pop(idx: number[]) {
    const els = this.cellEls();
    idx.forEach((k) =>
      els[k]?.animate?.([{ transform: "scale(.8)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }], {
        duration: 190,
        easing: "ease-out",
      })
    );
  }
  checkOver() {
    if (this.busy) return;
    const { grid, pieces } = this.state;
    if (!pieces.some((p) => p && fitsAny(grid, p.shape)))
      setTimeout(() => {
        if (!this.state.over) {
          this.setState({ over: true });
          this.sfxOver();
        }
      }, 450);
  }
  restart = () => {
    // A restart with points on the board is a finished run too.
    if (!this.state.over) this.submitRun();
    this.effects.forEach((e) => {
      if (e.kind === "clear") e.cleared.forEach((k) => e.els[k] && (e.els[k].style.transform = ""));
    });
    this.effects = [];
    this.busy = 0;
    this.pending = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    const cv = this.canvasRef.current;
    cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    if (this.frameRef.current) this.frameRef.current.style.transform = "";
    this.setState({ ...this.fresh(), boardOpen: false });
  };

  // ── effects ────────────────────────────────────────────────────────────

  sizeCanvas(): DOMRect {
    const cv = this.canvasRef.current!, r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const Wd = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== Wd || cv.height !== H) {
      cv.width = Wd;
      cv.height = H;
    }
    this.ctx = cv.getContext("2d");
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cw = r.width;
    this.ch = r.height;
    return r;
  }
  boardBox(cr: DOMRect): BoardBox {
    const b = this.frameRef.current!.getBoundingClientRect();
    return { x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height, cx: b.left - cr.left + b.width / 2, cy: b.top - cr.top + b.height / 2 };
  }
  poly(pts: [number, number][]): Poly {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, total: cum[cum.length - 1] || 1 };
  }
  genCrack(l: Line, rects: Record<number, Rect>, k: number): CrackGeo {
    const f = rects[l.cells[0]], z = rects[l.cells[l.cells.length - 1]], cs = f.w, row = l.type === "row";
    const a0 = row ? f.x : f.y, a1 = row ? z.x + z.w : z.y + z.h, b = row ? f.y + f.h / 2 : f.x + f.w / 2;
    const map = ([a, bb]: [number, number]): [number, number] => (row ? [a, bb] : [bb, a]);
    const ac = (a0 + a1) / 2 + rnd(-0.3, 0.3) * cs;
    const sides: Poly[] = [], branches: Poly[] = [];
    [-1, 1].forEach((dir) => {
      const P: [number, number][] = [[ac, b]];
      let a = ac, off = 0;
      const end = dir > 0 ? a1 - 2 : a0 + 2;
      while (dir > 0 ? a < end : a > end) {
        a += dir * cs * rnd(0.2, 0.42);
        if (dir > 0 ? a > end : a < end) a = end;
        off = clamp(off + rnd(-0.5, 0.5) * cs * 0.42, -cs * 0.3, cs * 0.3);
        P.push([a, b + off]);
      }
      const s = this.poly(P.map(map));
      sides.push(s);
      const nb = Math.max(2, Math.round((rnd(1.4, 2.4) * k * l.cells.length) / 4));
      for (let j = 0; j < nb; j++) {
        const idx = 1 + Math.floor(Math.random() * (P.length - 1)), o = P[Math.min(idx, P.length - 1)];
        const sg = Math.random() < 0.5 ? -1 : 1;
        let ang = rnd(0.6, 1.2), pa = o[0], pb = o[1];
        const BP: [number, number][] = [[pa, pb]];
        const segs = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let q = 0; q < segs; q++) {
          const L = cs * rnd(0.13, 0.28);
          pa += dir * Math.cos(ang) * L;
          pb = clamp(pb + sg * Math.sin(ang) * L, b - cs * 0.46, b + cs * 0.46);
          BP.push([pa, pb]);
          ang = clamp(ang + rnd(-0.4, 0.4), 0.3, 1.4);
        }
        const bs = this.poly(BP.map(map));
        bs.f0 = s.cum[Math.min(idx, P.length - 1)] / s.total;
        branches.push(bs);
      }
    });
    return { sides, branches, row, center: row ? [(a0 + a1) / 2, b] : [b, (a0 + a1) / 2], half: (a1 - a0) / 2 };
  }
  startClear(lines: Line[], combo: number, pts: number) {
    const cv = this.canvasRef.current, els = this.cellEls();
    const cleared = new Set<number>();
    lines.forEach((l) => l.cells.forEach((x) => cleared.add(x)));
    if (!cv || !els.length || !this.frameRef.current) {
      this.busy++;
      this.removeCells([...cleared]);
      return;
    }
    const cr = this.sizeCanvas(), th = this.theme();
    const rects: Record<number, Rect> = {}, colors: ClearEffect["colors"] = {}, owner: Record<number, number> = {};
    cleared.forEach((x) => {
      const b = els[x].getBoundingClientRect();
      rects[x] = { x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height };
      const bl = th.blocks[(this.state.grid[x] ?? 0) % 5];
      colors[x] = { base: bl[0], dark: bl[1] };
    });
    const n = lines.length;
    const k = (n >= 3 ? 1.45 : n === 2 ? 1.2 : 1) * (1 + Math.min(combo - 1, 6) * 0.06) * INTENSITY;
    const swing = n >= 3 ? 440 : 0;
    const T = { impact: n >= 3 ? 150 : 120, crack: n >= 3 ? 300 : n === 2 ? 360 : 420, fail: 110 };
    const geo = lines.map((l) => this.genCrack(l, rects, k));
    lines.forEach((l, li) => l.cells.forEach((x) => owner[x] ?? (owner[x] = li)));
    const now = performance.now(), bb = this.boardBox(cr);
    const main = n >= 4 ? "Structural failure!" : n === 3 ? "Triple crack!" : n === 2 ? "Double crack!" : combo >= 2 ? `Combo x${combo}` : null;
    const second = n >= 2 && combo >= 2 ? `Combo x${combo}  +${fmt(pts)}` : `+${fmt(pts)}`;
    let ball: Ball | null = null;
    if (swing) {
      let hx = 0, hy = 0;
      for (const x of cleared) {
        hx += rects[x].x + rects[x].w / 2;
        hy += rects[x].y + rects[x].h / 2;
      }
      hx /= cleared.size;
      hy /= cleared.size;
      const Lc = Math.max(bb.w * 1.1, 420);
      ball = { hx, hy, px: hx + bb.w * 0.08, py: hy - Lc, L: Lc, R: rects[[...cleared][0]].w * 0.95, t0: now, swing };
    }
    const e: ClearEffect = {
      kind: "clear", t0: now + swing, last: now, T, k, n, geo, cleared: [...cleared], rects, colors, owner, els,
      removed: false, frags: [], dust: [], bb, main, second, ball, crack: th.crack, label: th.label, dcols: th.dust,
    };
    if (!swing) e.cleared.forEach((x) => Math.random() < 0.45 * k && this.addDust(e, rects[x], 2, 0.5));
    this.busy++;
    this.effects.push(e);
    this.sfxClear(T, n, swing / 1000);
    this.loop();
  }
  addDust(e: ClearEffect, r: Rect, count: number, s: number) {
    for (let j = 0; j < count; j++)
      e.dust.push({ x: r.x + rnd(0, r.w), y: r.y + rnd(0, r.h), vx: rnd(-30, 30) * s, vy: rnd(-70, -15) * s, r: rnd(1.5, 3.5), g: rnd(3, 7), age: 0, life: rnd(380, 700), col: e.dcols[j % 3] });
  }
  spawnFrags(e: ClearEffect) {
    e.cleared.forEach((x) => {
      const r = e.rects[x], c = e.colors[x], g = e.geo[e.owner[x]];
      const P: [number, number][] = [
        [r.x, r.y], [r.x + r.w * rnd(0.3, 0.7), r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h * rnd(0.3, 0.7)],
        [r.x + r.w, r.y + r.h], [r.x + r.w * rnd(0.3, 0.7), r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h * rnd(0.3, 0.7)],
      ];
      const C: [number, number] = [r.x + r.w * rnd(0.35, 0.65), r.y + r.h * rnd(0.35, 0.65)], step = e.k > 1.15 ? 1 : 2;
      for (let j = 0; j < 8; j += step) {
        const pts: [number, number][] = [C, P[j], P[(j + 1) % 8]];
        if (step === 2) pts.push(P[(j + 2) % 8]);
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const across = g.row ? Math.sign(cy - g.center[1] || rnd(-1, 1)) : Math.sign(cx - g.center[0] || rnd(-1, 1));
        const along = g.row ? (cx - g.center[0]) / g.half : (cy - g.center[1]) / g.half;
        const va = along * rnd(40, 130) * e.k, vc = across * rnd(60, 190) * e.k;
        const bx = e.ball ? rnd(120, 320) * e.k : 0;
        e.frags.push({
          x: cx, y: cy, pts: pts.map((p) => [p[0] - cx, p[1] - cy]),
          vx: (g.row ? va : vc) + bx, vy: (g.row ? vc : va) - rnd(40, 110),
          rot: 0, vr: rnd(-9, 9), age: 0, life: rnd(420, 620), fill: Math.random() < 0.25 ? c.dark : c.base, edge: c.dark,
        });
      }
      this.addDust(e, r, Math.round(3 * e.k), 1);
    });
  }
  removeCells(cleared: number[]) {
    this.setState(
      (s) => {
        const g = s.grid.slice();
        cleared.forEach((k) => (g[k] = null));
        return { grid: g };
      },
      () => {
        this.busy = Math.max(0, this.busy - 1);
        if (this.pending && !this.busy) {
          const q = this.pending;
          this.pending = null;
          this.place(q.i, q.r, q.c);
        } else this.checkOver();
      }
    );
  }
  drawPartial(ctx: CanvasRenderingContext2D, s: Poly, frac: number) {
    if (frac <= 0) return;
    const L = s.total * frac, P = s.pts;
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) {
      if (s.cum[i] <= L) ctx.lineTo(P[i][0], P[i][1]);
      else {
        const t = (L - s.cum[i - 1]) / (s.cum[i] - s.cum[i - 1]);
        ctx.lineTo(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t);
        break;
      }
    }
    ctx.stroke();
  }
  rr(ctx: CanvasRenderingContext2D, r: Rect, rad: number) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, rad);
    else ctx.rect(r.x, r.y, r.w, r.h);
  }
  loop() {
    if (this.raf) return;
    const step = () => {
      const now = performance.now(), ctx = this.ctx;
      if (!ctx) {
        this.raf = null;
        return;
      }
      ctx.clearRect(0, 0, this.cw, this.ch);
      this.effects = this.effects.filter((e) => (e.kind === "best" ? this.drawBest(ctx, e, now) : this.drawEffect(ctx, e, now)));
      if (this.effects.length) this.raf = requestAnimationFrame(step);
      else {
        this.raf = null;
        ctx.clearRect(0, 0, this.cw, this.ch);
      }
    };
    this.raf = requestAnimationFrame(step);
  }
  ballAngle(b: Ball, now: number) {
    const tb = now - b.t0;
    if (tb < b.swing) return { th: -1.15 * Math.cos(((Math.PI / 2) * tb) / b.swing), a: 1, alive: true, pre: true };
    const u = (tb - b.swing) / 560;
    if (u >= 1) return { th: 0, a: 0, alive: false, pre: false };
    return { th: -0.24 * Math.sin(Math.PI * u), a: 1 - u * u, alive: true, pre: false };
  }
  drawBall(ctx: CanvasRenderingContext2D, b: Ball, th: number, a: number) {
    const x = b.px + b.L * Math.sin(th), y = b.py + b.L * Math.cos(th), R = b.R;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#2b2d31";
    ctx.lineWidth = Math.max(3, R * 0.2);
    ctx.setLineDash([R * 0.38, R * 0.2]);
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(x - Math.sin(th) * R, y - Math.cos(th) * R);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.ellipse(x + R * 0.15, y + R * 0.25, R, R, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
    g.addColorStop(0, "#a7adb4");
    g.addColorStop(0.45, "#555a61");
    g.addColorStop(1, "#1b1d20");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1b1d20";
    ctx.lineWidth = Math.max(2, R * 0.12);
    ctx.beginPath();
    ctx.arc(x - Math.sin(th) * R * 1.05, y - Math.cos(th) * R * 1.05, R * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawEffect(ctx: CanvasRenderingContext2D, e: ClearEffect, now: number): boolean {
    const t = now - e.t0, { impact, crack, fail } = e.T, tr = impact + crack + fail, k = e.k, dt = Math.min(0.05, (now - e.last) / 1000);
    e.last = now;
    let ballAlive = false;
    if (e.ball) {
      const s = this.ballAngle(e.ball, now);
      if (s.alive) {
        ballAlive = true;
        if (s.pre)
          for (let q = 3; q >= 1; q--) {
            const p = this.ballAngle(e.ball, now - q * 22);
            if (p.pre) this.drawBall(ctx, e.ball, p.th, 0.12 * (4 - q));
          }
        this.drawBall(ctx, e.ball, s.th, s.a);
      }
    }
    if (t < 0) return true;
    if (e.ball && !e.hit) {
      e.hit = true;
      e.kick = now;
      e.kickA = 3.8 * k;
      vibrate(30);
      e.cleared.forEach((x) => Math.random() < 0.7 && this.addDust(e, e.rects[x], 3, 1.2));
    }
    if (t < tr) {
      const amp = t < impact ? 1.8 * k * (1 - t / impact) : t < impact + crack ? 0.7 * k : 1.9 * k;
      e.cleared.forEach((x) => {
        if (e.els[x]) e.els[x].style.transform = `translate(${rnd(-amp, amp).toFixed(2)}px,${rnd(-amp, amp).toFixed(2)}px)`;
      });
      if (t < impact) {
        ctx.fillStyle = `rgba(255,255,255,${0.22 * (1 - t / impact)})`;
        e.cleared.forEach((x) => {
          this.rr(ctx, e.rects[x], 6);
          ctx.fill();
        });
      }
      const ft = t > impact + crack ? (t - impact - crack) / fail : 0;
      if (ft > 0) {
        ctx.fillStyle = "#000";
        ctx.globalAlpha = 0.16 * ft;
        e.cleared.forEach((x) => {
          this.rr(ctx, e.rects[x], 6);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
      if (t >= impact) {
        const p = clamp((t - impact) / crack, 0, 1), cp = 1 - Math.pow(1 - p, 2.2);
        const w = 1.9 + 1.3 * ft;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ([[0.8, "rgba(255,255,255,.45)", w * 0.8], [0, e.crack, w]] as const).forEach(([o, col, lw]) => {
          ctx.save();
          ctx.translate(o, o);
          ctx.strokeStyle = col;
          ctx.lineWidth = lw;
          ctx.globalAlpha = o ? 0.9 : 0.8 + 0.2 * ft;
          e.geo.forEach((g) => {
            g.sides.forEach((s) => this.drawPartial(ctx, s, cp));
            ctx.lineWidth = lw * 0.62;
            g.branches.forEach((b) => this.drawPartial(ctx, b, clamp((cp - (b.f0 ?? 0)) / 0.28, 0, 1)));
            ctx.lineWidth = lw;
          });
          ctx.restore();
        });
      }
    } else if (!e.removed) {
      e.removed = true;
      e.kick = now;
      e.kickA = 2.6 * k;
      e.cleared.forEach((x) => e.els[x] && (e.els[x].style.transform = ""));
      this.spawnFrags(e);
      this.removeCells(e.cleared);
      vibrate(18 * e.n);
    }
    const fr = this.frameRef.current;
    if (e.kick && fr) {
      const q = (now - e.kick) / 220;
      if (q < 1) {
        const a = (e.kickA ?? 0) * (1 - q);
        fr.style.transform = `translate(${rnd(-a, a).toFixed(2)}px,${rnd(-a, a).toFixed(2)}px)`;
      } else if (e.kickDone !== e.kick) {
        e.kickDone = e.kick;
        fr.style.transform = "";
      }
    }
    e.frags = e.frags.filter((f) => {
      f.age += dt * 1000;
      if (f.age > f.life) return false;
      f.vy += 900 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = 1 - Math.pow(f.age / f.life, 1.6);
      const sc = 1 - 0.25 * (f.age / f.life);
      ctx.scale(sc, sc);
      ctx.beginPath();
      f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      ctx.strokeStyle = f.edge;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
      return true;
    });
    e.dust = e.dust.filter((d) => {
      d.age += dt * 1000;
      if (d.age > d.life) return false;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy *= 0.96;
      d.r += d.g * dt;
      ctx.globalAlpha = 0.55 * (1 - d.age / d.life);
      ctx.fillStyle = d.col;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });
    let labelAlive = false;
    if (t >= tr) {
      const lt = t - tr;
      if (lt < 950) {
        labelAlive = true;
        const s = lt < 180 ? 0.6 + 0.5 * (lt / 180) - 0.1 * Math.pow(lt / 180, 4) : 1, a = lt > 680 ? 1 - (lt - 680) / 270 : 1;
        const size = Math.round(Math.min(e.bb.w, 560) * 0.085);
        ctx.save();
        ctx.translate(e.bb.cx, e.bb.cy - lt * 0.02);
        ctx.scale(s, s);
        ctx.globalAlpha = a;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.strokeStyle = e.label[1];
        ctx.fillStyle = e.label[0];
        const y2 = e.main ? size * 0.95 : 0;
        if (e.main) {
          ctx.font = `${size}px ${LABEL_FONT}`;
          ctx.lineWidth = 8;
          ctx.strokeText(e.main, 0, 0);
          ctx.fillText(e.main, 0, 0);
        }
        const s2 = Math.round(size * (e.main ? 0.62 : 0.8));
        ctx.font = `${s2}px ${LABEL_FONT}`;
        ctx.lineWidth = 6;
        ctx.strokeText(e.second, 0, y2);
        ctx.fillText(e.second, 0, y2);
        ctx.restore();
      }
    }
    return !e.removed || e.frags.length > 0 || e.dust.length > 0 || labelAlive || ballAlive;
  }
  celebrate() {
    if (!this.canvasRef.current || !this.frameRef.current || this.state.over) return;
    const cr = this.sizeCanvas(), bb = this.boardBox(cr), th = this.theme(), now = performance.now();
    const bits: BestEffect["bits"] = [];
    for (let j = 0; j < 70; j++) {
      const w = rnd(8, 15);
      bits.push({ x: bb.cx + rnd(-0.65, 0.65) * bb.w, y: bb.y - rnd(0, 160), vx: rnd(-40, 40), vy: rnd(60, 220), w, h: w * 0.5, rot: rnd(0, 6), vr: rnd(-6, 6), fill: th.blocks[j % 5][0] });
    }
    this.effects.push({ kind: "best", t0: now, last: now, bb, bits, label: th.label });
    this.bump(this.bestRef.current, 1.2);
    this.sfxBest();
    this.loop();
  }
  drawBest(ctx: CanvasRenderingContext2D, e: BestEffect, now: number): boolean {
    const t = now - e.t0, dt = Math.min(0.05, (now - e.last) / 1000);
    e.last = now;
    if (t > 2000) return false;
    const fade = t > 1500 ? 1 - (t - 1500) / 500 : 1;
    e.bits.forEach((b) => {
      b.vy += 300 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.fill;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.fillRect(-b.w / 2, b.h / 2 - 1.5, b.w, 1.5);
      ctx.restore();
    });
    if (t < 1500) {
      const s = t < 220 ? 0.5 + 0.6 * (t / 220) - 0.1 * Math.pow(t / 220, 4) : 1, a = t > 1150 ? 1 - (t - 1150) / 350 : 1;
      const size = Math.round(Math.min(e.bb.w, 560) * 0.11);
      ctx.save();
      ctx.translate(e.bb.cx, e.bb.y + e.bb.h * 0.22);
      ctx.scale(s, s);
      ctx.rotate(-0.05);
      ctx.globalAlpha = a;
      ctx.font = `${size}px ${LABEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 10;
      ctx.strokeStyle = e.label[1];
      ctx.strokeText("NEW BEST!", 0, 0);
      ctx.fillStyle = e.label[0];
      ctx.fillText("NEW BEST!", 0, 0);
      ctx.restore();
    }
    return true;
  }

  // ── audio (all generated, no files) ──────────────────────────────────────

  ensureAudio() {
    try {
      if (!this.ac) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = (this.ac = new Ctx());
        const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = b;
        this.master = ac.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(ac.destination);
        this.sfxG = ac.createGain();
        this.sfxG.gain.value = 1;
        this.sfxG.connect(this.master);
        this.musG = ac.createGain();
        this.musG.gain.value = 0.55;
        this.musG.connect(this.master);
      }
      if (this.ac.state === "suspended") this.ac.resume();
      this.syncMusic();
    } catch {}
  }
  noise(t: number, dur: number, freq: number, q: number, gain: number, type?: BiquadFilterType, dest?: AudioNode) {
    const ac = this.ac!, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this.noiseBuf;
    f.type = type || "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxG!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
  tone(t: number, f0: number, f1: number, dur: number, gain: number, type?: OscillatorType, dest?: AudioNode) {
    const ac = this.ac!, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxG!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  canPlay() {
    return !!(this.ac && this.noiseBuf && this.state.sfx);
  }
  sfxPlace() {
    if (!this.canPlay()) return;
    const t = this.ac!.currentTime;
    this.tone(t, 190, 70, 0.1, 0.28);
    this.noise(t, 0.035, 2600, 1.2, 0.06);
  }
  sfxClear(T: ClearEffect["T"], n: number, delay: number) {
    if (!this.canPlay()) return;
    const ac = this.ac!, t0 = ac.currentTime;
    if (delay) {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = this.noiseBuf;
      f.type = "bandpass";
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(260, t0);
      f.frequency.exponentialRampToValueAtTime(1500, t0 + delay);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + delay * 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.08);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfxG!);
      src.start(t0);
      src.stop(t0 + delay + 0.1);
      const ti = t0 + delay;
      this.tone(ti, 95, 36, 0.42, 0.6);
      this.noise(ti, 0.32, 320, 0.8, 0.4, "lowpass");
      this.tone(ti, 1250, 900, 0.14, 0.06, "triangle");
      this.tone(ti + 0.01, 1880, 1500, 0.1, 0.03, "triangle");
    }
    const t = t0 + delay, t1 = t + T.impact / 1000, cr = T.crack / 1000, t2 = t1 + cr + T.fail / 1000;
    this.tone(t, 120, 60, 0.12, 0.12 * Math.min(n, 3));
    this.noise(t1, 0.05, 2800, 0.8, 0.16, "highpass");
    this.tone(t1, 900, 280, 0.04, 0.05, "triangle");
    const cnt = 7 + 3 * n;
    for (let j = 0; j < cnt; j++) this.noise(t1 + (j / cnt) * cr + rnd(0, 0.015), 0.018, rnd(2800, 5200), 2, 0.05 + 0.01 * n);
    for (let layer = 0; layer < Math.min(n, 3); layer++) {
      const tt = t2 + layer * 0.03;
      this.noise(tt, 0.38, 1500 - layer * 200, 0.7, 0.2);
      this.noise(tt, 0.14, 380, 0.9, 0.22, "lowpass");
      for (let j = 0; j < 4 + n; j++) this.tone(tt + rnd(0, 0.22), rnd(2400, 5200), rnd(1800, 4000), 0.06, 0.025, "sine");
    }
  }
  sfxFanfare() {
    if (!this.canPlay()) return;
    const t = this.ac!.currentTime + 0.05;
    [72, 76, 79, 84].forEach((m, i) => {
      this.tone(t + i * 0.1, mf(m), mf(m), 0.38, 0.08, "triangle");
      this.tone(t + i * 0.1, mf(m + 12), mf(m + 12), 0.2, 0.02, "sine");
    });
    [72, 76, 79, 84].forEach((m) => this.tone(t + 0.42, mf(m), mf(m) * 1.003, 1.1, 0.035, "triangle"));
    this.noise(t + 0.42, 0.5, 7000, 0.6, 0.03, "highpass");
  }
  sfxBest() {
    if (!this.canPlay()) return;
    const t = this.ac!.currentTime + 0.02;
    [84, 88, 91, 96, 100].forEach((m, i) => this.tone(t + i * 0.065, mf(m), mf(m), 0.32, 0.05, "sine"));
    this.noise(t, 0.6, 8000, 0.5, 0.025, "highpass");
  }
  sfxFizzle() {
    if (!this.canPlay()) return;
    const t = this.ac!.currentTime;
    this.tone(t, 420, 140, 0.35, 0.07, "sine");
    this.noise(t, 0.25, 900, 0.7, 0.03);
  }
  sfxOver() {
    if (!this.canPlay()) return;
    const t = this.ac!.currentTime;
    this.tone(t, 300, 110, 0.6, 0.1, "triangle");
    this.tone(t + 0.16, 220, 80, 0.75, 0.08, "triangle");
  }

  syncMusic() {
    const s = this.state, on = !!(this.ac && s.music && !s.paused && !s.over && !document.hidden);
    if (on && !this.mTimer) this.startMusic();
    else if (!on && this.mTimer) this.stopMusic();
  }
  startMusic() {
    const ac = this.ac!;
    this.mStep = 0;
    this.mNext = ac.currentTime + 0.08;
    this.musG!.gain.cancelScheduledValues(ac.currentTime);
    this.musG!.gain.setTargetAtTime(0.55, ac.currentTime, 0.1);
    this.mTimer = setInterval(() => {
      if (!this.ac) return;
      while (this.mNext < this.ac.currentTime + 0.3) {
        this.musicStep(this.mStep, this.mNext);
        this.mNext += 0.3;
        this.mStep++;
      }
    }, 80);
  }
  stopMusic() {
    if (this.mTimer) {
      clearInterval(this.mTimer);
      this.mTimer = null;
    }
    if (this.ac && this.musG) this.musG.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.08);
  }
  musicStep(i: number, t: number) {
    const G = this.musG!, s = i % 8, tr = KEYS[themeIdx(this.state.score)], ch = PROG[Math.floor(i / 8) % 4].map((m) => m + tr);
    if (s === 0 || s === 4) this.tone(t, mf(ch[0] - 12), mf(ch[0] - 12), 0.55, 0.1, "triangle", G);
    if (s === 0) this.tone(t, 120, 45, 0.16, 0.16, "sine", G);
    if (s === 4) this.noise(t, 0.09, 1800, 0.8, 0.05, "bandpass", G);
    if (s % 2) this.noise(t, 0.025, 8000, 0.7, 0.02, "highpass", G);
    const m = ch[[0, 1, 2, 1, 0, 1, 2, 1][s]] + (s >= 4 ? 12 : 0);
    this.tone(t, mf(m), mf(m) * 0.998, 0.24, 0.032, "triangle", G);
  }

  // ── controls ───────────────────────────────────────────────────────────

  toggleMusic = () => {
    this.ensureAudio();
    const v = !this.state.music;
    saveFlag("music", v);
    this.setState({ music: v });
  };
  toggleSfx = () => {
    this.ensureAudio();
    const v = !this.state.sfx;
    saveFlag("sfx", v);
    this.setState({ sfx: v });
  };
  toggleExpanded = () => this.setState((s) => ({ expanded: !s.expanded }));

  // ── render ─────────────────────────────────────────────────────────────

  render() {
    const s = this.state, { grid, drag, pieces } = s;
    const ti = themeIdx(s.score), th = THEMES[ti], wall = wallNo(s.score);

    const prev = new Set<number>(), glow = new Set<number>();
    let pc = 0;
    const dp = drag ? pieces[drag.i] : null;
    if (drag && drag.ok && dp) {
      pc = dp.color;
      const g = grid.slice();
      dp.shape.forEach(([a, b]) => {
        const k = (drag.r + a) * N + drag.c + b;
        prev.add(k);
        g[k] = dp.color;
      });
      findLines(g).forEach((l) => l.cells.forEach((k) => glow.add(k)));
    }

    const hot = s.combo >= 2;
    const track = th.dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.09)";
    const lit = s.combo ? COMBO_GRACE - s.miss : 0;
    const newBest = s.over && s.bestAtStart > 0 && s.score > s.bestAtStart;
    const nearMiss = s.over && s.bestAtStart > 0 && s.score < s.bestAtStart && s.score >= s.bestAtStart * 0.8;
    const gridTpl = `repeat(${N}, minmax(0, 1fr))`;

    const root: CSSProperties = s.expanded
      ? { position: "fixed", inset: 0, zIndex: 100, height: "100dvh", padding: "max(12px, env(safe-area-inset-top)) 14px max(12px, env(safe-area-inset-bottom))" }
      : { position: "relative", height: "min(calc(100dvh - 170px), 900px)", minHeight: 560, borderRadius: 28, padding: "12px 14px" };

    return (
      <div className="space-y-4">
        <div
          ref={this.rootRef}
          className={`cb ${caprasimo.variable} ${figtree.variable}`}
          style={{
            ...root,
            display: "flex",
            justifyContent: "center",
            overflow: "hidden",
            background: th.base,
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTapHighlightColor: "transparent",
            overscrollBehavior: "none",
          }}
        >
          {THEMES.map((T, j) => (
            <div key={T.name} style={{ position: "absolute", inset: 0, background: T.page, opacity: j === ti ? 1 : 0, transition: "opacity 1.4s ease", pointerEvents: "none" }} />
          ))}

          <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 680, height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Wordmark ink={th.ink} sub={th.sub} pageBase={th.base} />
              <div className="cb-actions" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-secondary btn-icon" onClick={this.toggleMusic} title="Music" aria-label="Music" style={{ opacity: s.music ? 1 : 0.45 }}>
                  <Music {...ICON} />
                </button>
                <button className="btn btn-secondary btn-icon" onClick={this.toggleSfx} title="Sound effects" aria-label="Sound effects">
                  {s.sfx ? <Volume2 {...ICON} /> : <VolumeX {...ICON} />}
                </button>
                <button className="btn btn-secondary btn-icon" onClick={() => this.setState({ boardOpen: true })} title="Leaderboard" aria-label="Leaderboard">
                  <Trophy {...ICON} />
                </button>
                <button className="btn btn-secondary btn-icon" onClick={() => !s.over && this.setState({ paused: true })} title="Pause" aria-label="Pause">
                  <Pause {...ICON} />
                </button>
                <button className="btn btn-secondary btn-icon" onClick={this.toggleExpanded} title={s.expanded ? "Exit full screen" : "Full screen"} aria-label={s.expanded ? "Exit full screen" : "Full screen"}>
                  {s.expanded ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
                </button>
              </div>
            </header>

            <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
              <div ref={this.wallRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, padding: "2px 4px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: th.sub }}>Score</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 34, lineHeight: 1, color: th.ink, transition: "color 1.2s" }}>{fmt(s.score)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: th.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Wall {wall} · {th.name} · {fmt(1000 - (s.score % 1000))} to next
                </div>
              </div>
              <Chip ref={this.bestRef} label="Best" value={fmt(s.best)} />
              <Chip
                ref={this.comboRef}
                label="Combo"
                value={s.combo ? `x${s.combo}` : "–"}
                bg={hot ? HOT : undefined}
                ink={hot ? "#ffffff" : undefined}
                sub={hot ? "rgba(255,255,255,.88)" : undefined}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: th.sub }}>Heat</div>
              <div style={{ flex: 1, height: 10, borderRadius: 999, background: track, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,.18)" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${s.combo ? Math.min(100, 12.5 * s.combo) : 0}%`,
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${th.accent}, #e8663a 65%, #d63c24)`,
                    boxShadow: s.combo >= 5 ? "0 0 12px rgba(232,102,58,.85)" : "none",
                    transition: "width .45s cubic-bezier(.3,1.4,.5,1), box-shadow .3s",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map((j) => (
                  <div key={j} style={{ width: 9, height: 9, borderRadius: "50%", background: j < lit ? HOT : track, transition: "background .25s" }} />
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, containerType: "size", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div ref={this.frameRef} style={{ position: "relative", width: "min(calc(100cqw - 16px), calc(100cqh - 16px))", aspectRatio: "1" }}>
                {THEMES.map((T, j) => (
                  <div key={T.name} style={{ position: "absolute", inset: 0, borderRadius: "var(--radius-lg)", background: T.board, opacity: j === ti ? 1 : 0, transition: "opacity 1.4s ease", boxShadow: "var(--shadow-md)" }} />
                ))}
                <div ref={this.gridRef} style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: gridTpl, gridTemplateRows: gridTpl, gap: 4, padding: 10 }}>
                  {grid.map((v, i) => {
                    const gl = glow.has(i);
                    let bg = th.empty, sh = th.esh, op = 1, fx = "none";
                    if (v != null) {
                      bg = bgOf(gl ? pc : v, th);
                      sh = th.sh;
                      if (gl) fx = "brightness(1.12) saturate(1.1)";
                    } else if (prev.has(i)) {
                      bg = bgOf(pc, th);
                      sh = th.sh;
                      op = gl ? 1 : 0.45;
                    }
                    return (
                      <div key={i} data-i={i} style={{ minWidth: 0, minHeight: 0, borderRadius: 6, background: bg, boxShadow: sh, opacity: op, filter: fx, transition: "opacity .1s, filter .12s" }} />
                    );
                  })}
                </div>
                <Corners accent={th.accent} />
              </div>
            </div>

            <div
              ref={this.trayRef}
              style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, padding: 10, borderRadius: "var(--radius-lg)", background: th.tray, transition: "background 1.2s", flexShrink: 0, ["--tcs" as string]: "clamp(10px, min(4.4vw, 2.4dvh), 22px)" }}
            >
              {pieces.map((p, i) => {
                const dragging = drag?.i === i;
                const playable = p ? fitsAny(grid, p.shape) : false;
                return (
                  <div
                    key={p ? p.id : `empty-${i}`}
                    className="tray-slot"
                    onPointerDown={p ? (e) => this.startDrag(i, e) : undefined}
                    style={{ height: "calc(var(--tcs) * 5 + 30px)", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", cursor: p ? (dragging ? "grabbing" : "grab") : "default", borderRadius: "var(--radius-md)" }}
                  >
                    {p && (
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${p.w}, var(--tcs))`, gridTemplateRows: `repeat(${p.h}, var(--tcs))`, gap: 3, opacity: dragging ? 0 : playable ? 1 : 0.35, transition: "opacity .15s" }}>
                        {p.shape.map(([a, b]) => (
                          <div key={`${a}-${b}`} style={{ gridColumn: b + 1, gridRow: a + 1, borderRadius: 4, background: bgOf(p.color, th), boxShadow: th.sh }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {s.score === 0 && !drag && (
              <p style={{ flexShrink: 0, textAlign: "center", fontSize: 12, lineHeight: 1.3, color: th.sub }}>
                Drag a block onto the grid. Fill a row or column to crack it. Keep cracking to build heat.
              </p>
            )}
          </div>

          <canvas ref={this.canvasRef} style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100dvh", pointerEvents: "none", zIndex: 40 }} />

          {drag && dp && (
            <div
              style={{ position: "fixed", left: drag.x, top: drag.y, display: "grid", gridTemplateColumns: `repeat(${dp.w}, ${drag.cs}px)`, gridTemplateRows: `repeat(${dp.h}, ${drag.cs}px)`, gap: drag.gap, pointerEvents: "none", zIndex: 50, filter: "drop-shadow(0 10px 14px rgba(0,0,0,.3))" }}
            >
              {dp.shape.map(([a, b]) => (
                <div key={`${a}-${b}`} style={{ gridColumn: b + 1, gridRow: a + 1, borderRadius: 6, background: bgOf(dp.color, th), boxShadow: th.sh }} />
              ))}
            </div>
          )}

          {s.paused && !s.boardOpen && (
            <Modal z={60} max={340}>
              <h2>Paused</h2>
              <p style={{ color: "var(--color-neutral-700)" }}>The site&apos;s on hold. Your board is saved as it is.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <button className="btn btn-primary" onClick={() => this.setState({ paused: false })} style={{ padding: "13px 20px", fontSize: 16 }}>
                  Resume
                </button>
                <button className="btn btn-secondary" onClick={this.restart} style={{ padding: "12px 20px" }}>
                  <RotateCcw size={15} strokeWidth={2.75} /> Restart
                </button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button className="btn btn-ghost" onClick={this.toggleMusic} style={{ padding: "10px 12px" }}>
                    Music: {s.music ? "on" : "off"}
                  </button>
                  <button className="btn btn-ghost" onClick={this.toggleSfx} style={{ padding: "10px 12px" }}>
                    Effects: {s.sfx ? "on" : "off"}
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {s.over && !s.boardOpen && (
            <Modal z={70} max={400}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span className="tag tag-accent-2">CrackBlast · An AusDilaps Challenge</span>
                {newBest && <span className="tag tag-accent">New best score</span>}
              </div>
              <h2 style={{ fontSize: "clamp(28px,7vw,34px)", lineHeight: 1.05 }}>INSPECTION COMPLETE</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>Your CrackBlast Score</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 60, lineHeight: 1, color: "var(--color-accent-700)" }}>{fmt(s.score)}</div>
                <div style={{ fontSize: 14, color: "var(--color-neutral-700)" }}>
                  You reached Wall {wall}: {th.name}
                  {s.saving ? " · saving…" : s.rank ? ` · #${s.rank} on the staff board` : ""}
                </div>
              </div>
              {nearMiss && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 16px", borderRadius: "var(--radius-md)", background: "var(--color-accent-100)" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-800)" }}>So close!</div>
                  <div style={{ fontSize: 14, color: "var(--color-accent-900)" }}>Just {fmt(s.bestAtStart - s.score)} points short of your best.</div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                <Tile label="Best Score" value={fmt(s.best)} />
                <Tile label="Lines Cleared" value={fmt(s.lines)} />
                <Tile label="Best Combo" value={s.bestCombo ? `x${s.bestCombo}` : "–"} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <button className="btn btn-primary" onClick={this.restart} style={{ padding: "14px 20px", fontSize: 17 }}>
                  PLAY AGAIN
                </button>
                <button className="btn btn-secondary" onClick={() => this.setState({ boardOpen: true })} style={{ padding: "12px 20px" }}>
                  VIEW LEADERBOARD
                </button>
              </div>
            </Modal>
          )}

          {s.boardOpen && (
            <Modal z={75} max={440}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <h2 style={{ fontSize: 28 }}>Leaderboard</h2>
                <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>Best run per person</span>
              </div>
              <div style={{ maxHeight: "min(52dvh, 460px)", overflowY: "auto" }}>
                <BoardList rows={s.board} error={s.boardError} />
              </div>
              {s.rank && s.rank > s.board.length && (
                <p style={{ fontSize: 14, color: "var(--color-neutral-700)" }}>
                  You&apos;re #{s.rank} with {fmt(s.best)}.
                </p>
              )}
              <button className="btn btn-primary" onClick={() => this.setState({ boardOpen: false })} style={{ padding: "12px 20px" }}>
                {s.over ? "Back" : "Back to the board"}
              </button>
            </Modal>
          )}

          {s.toast && (
            <div style={{ position: "absolute", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 80, padding: "11px 20px", borderRadius: 999, background: "var(--color-neutral-900)", color: "var(--color-neutral-100)", fontSize: 14, fontWeight: 600, boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap" }}>
              {s.toast}
            </div>
          )}
        </div>

        <StaffBoard rows={s.board} error={s.boardError} rank={s.rank} best={s.best} />
      </div>
    );
  }
}

// ── pieces ─────────────────────────────────────────────────────────────────

function Wordmark({ ink, sub, pageBase }: { ink: string; sub: string; pageBase: string }) {
  const crack = { fill: "none", stroke: pageBase, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div className="cb-wordmark" style={{ display: "flex", alignItems: "baseline", fontFamily: "var(--font-heading)", lineHeight: 1, letterSpacing: ".01em" }}>
        <span style={{ position: "relative", color: ink, transition: "color 1.2s" }}>
          CRACK
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            <path d="M58 -2 L54 12 L61 17 L53 27 L57 33 L52 42" strokeWidth={2.4} {...crack} />
            <path d="M61 17 L70 21 L74 19" strokeWidth={1.6} {...crack} />
            <path d="M53 27 L45 30" strokeWidth={1.4} {...crack} />
          </svg>
        </span>
        <span style={{ position: "relative", display: "flex", alignItems: "baseline", color: "var(--color-accent)" }}>
          <span>BLA</span>
          <span style={{ display: "inline-block", transform: "translate(1px,-2px) rotate(6deg)" }}>S</span>
          <span style={{ display: "inline-block", transform: "translate(4px,-6px) rotate(14deg)" }}>T</span>
          <span style={{ position: "absolute", right: -14, top: -4, width: 6, height: 6, borderRadius: 2, background: "var(--color-accent-400)", transform: "rotate(20deg)" }} />
          <span style={{ position: "absolute", right: -22, top: 8, width: 4, height: 4, borderRadius: 1, background: "var(--color-accent-600)", transform: "rotate(-15deg)" }} />
        </span>
      </div>
      <div className="cb-tagline" style={{ fontWeight: 700, textTransform: "uppercase", color: sub, transition: "color 1.2s", whiteSpace: "nowrap" }}>An AusDilaps Challenge</div>
    </div>
  );
}

function Chip({ ref, label, value, bg, ink, sub }: { ref: React.Ref<HTMLDivElement>; label: string; value: string; bg?: string; ink?: string; sub?: string }) {
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "8px 16px", borderRadius: 999, background: bg ?? "var(--color-neutral-100)", boxShadow: "var(--shadow-sm)", minWidth: 84, transition: "background .3s" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: sub ?? "var(--color-neutral-700)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, lineHeight: 1, color: ink ?? "var(--color-text)" }}>{value}</div>
    </div>
  );
}

function Corners({ accent }: { accent: string }) {
  const b = `3px solid ${accent}`;
  const base: CSSProperties = { position: "absolute", width: 16, height: 16, pointerEvents: "none" };
  return (
    <>
      <div style={{ ...base, left: -7, top: -7, borderLeft: b, borderTop: b, borderTopLeftRadius: 8 }} />
      <div style={{ ...base, right: -7, top: -7, borderRight: b, borderTop: b, borderTopRightRadius: 8 }} />
      <div style={{ ...base, left: -7, bottom: -7, borderLeft: b, borderBottom: b, borderBottomLeftRadius: 8 }} />
      <div style={{ ...base, right: -7, bottom: -7, borderRight: b, borderBottom: b, borderBottomRightRadius: 8 }} />
    </>
  );
}

function Modal({ z, max, children }: { z: number; max: number; children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: z, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(20,18,17,.55)" }}>
      <div style={{ width: "100%", maxWidth: max, maxHeight: "100%", overflowY: "auto", background: "var(--color-bg)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: "28px 26px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

/** The in-game board, in the game's own look. */
function BoardList({ rows, error }: { rows: BoardRow[]; error: string | null }) {
  if (error) return <p style={{ color: "var(--color-neutral-700)" }}>{error}</p>;
  if (!rows.length) return <p style={{ color: "var(--color-neutral-700)" }}>No runs yet. Go first.</p>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r, i) => (
        <li
          key={`${r.name}-${i}`}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 999, background: r.isYou ? "var(--color-accent-100)" : i < 3 ? "var(--color-neutral-100)" : "transparent" }}
        >
          <span style={{ width: 24, fontFamily: "var(--font-heading)", color: i < 3 ? "var(--color-accent-700)" : "var(--color-neutral-700)" }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: r.isYou ? 700 : 600 }}>{r.name}</span>
          <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>Wall {r.wall}</span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, minWidth: 72, textAlign: "right" }}>{fmt(r.score)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The board under the game, in the portal's look — visible without playing. */
function StaffBoard({ rows, error, rank, best }: { rows: BoardRow[]; error: string | null; rank: number | null; best: number }) {
  return (
    <div className="rounded-xl border border-ad-border bg-ad-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ad-ink">Staff leaderboard</h3>
        <p className="text-xs text-ad-muted">
          Best run per person{rank ? ` · you're #${rank} with ${fmt(best)}` : ""}
        </p>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-ad-muted">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ad-muted">No runs yet. Go first.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ad-muted">
              <th className="w-8 font-medium">#</th>
              <th className="font-medium">Name</th>
              <th className="w-24 text-right font-medium">Score</th>
              <th className="w-16 text-right font-medium">Lines</th>
              <th className="w-16 text-right font-medium">Combo</th>
              <th className="w-14 text-right font-medium">Wall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} className={r.isYou ? "font-semibold text-ad-ink" : "text-ad-muted"}>
                <td className="py-1 tabular-nums">{i + 1}</td>
                <td className="truncate py-1">{r.name}</td>
                <td className="py-1 text-right tabular-nums text-ad-ink">{fmt(r.score)}</td>
                <td className="py-1 text-right tabular-nums">{fmt(r.lines)}</td>
                <td className="py-1 text-right tabular-nums">{r.bestCombo ? `x${r.bestCombo}` : "–"}</td>
                <td className="py-1 text-right tabular-nums">{r.wall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
