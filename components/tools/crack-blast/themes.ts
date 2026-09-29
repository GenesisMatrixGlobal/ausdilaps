/**
 * The nine walls — one theme per 1,000 points. Copied verbatim from the CrackBlast v2.0
 * design build. Every texture is layered CSS gradients, no images.
 */

export type Theme = {
  name: string;
  base: string;
  dark?: boolean;
  page: string;
  board: string;
  empty: string;
  esh: string;
  sh: string;
  ink: string;
  sub: string;
  tray: string;
  accent: string;
  crack: string;
  /** [fill, outline] for the canvas labels. */
  label: [string, string];
  dust: [string, string, string];
  /** [base, dark, texture key] × 5. */
  blocks: [string, string, string][];
};

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const W = (a: number) => `rgba(255,255,255,${a})`;
const K = (a: number) => `rgba(0,0,0,${a})`;
const speck = (a = 0.18, b = 0.12) => `radial-gradient(circle, ${W(a)} 0 1px, transparent 1.6px) 0 0/7px 7px, radial-gradient(circle, ${K(b)} 0 1px, transparent 1.6px) 3px 4px/9px 9px`;
const ML = K(.26);
export const TX: Record<string, string> = {
  brick: `linear-gradient(${ML}, ${ML}) 0 50%/100% 2px no-repeat, linear-gradient(${ML}, ${ML}) 72% 0/2px 50% no-repeat, linear-gradient(${ML}, ${ML}) 28% 100%/2px 50% no-repeat, ${speck()}`,
  strata: `repeating-linear-gradient(172deg, transparent 0 5px, ${K(.07)} 5px 7px, transparent 7px 11px, ${W(.1)} 11px 12px), ${speck(.22, .08)}`,
  besser: `radial-gradient(ellipse 20% 27% at 30% 50%, ${K(.32)} 0 70%, transparent 76%), radial-gradient(ellipse 20% 27% at 70% 50%, ${K(.32)} 0 70%, transparent 76%), ${speck(.14, .16)}`,
  paint: `linear-gradient(180deg, ${W(.2)}, transparent 45%, ${K(.07)}), repeating-linear-gradient(90deg, transparent 0 3px, ${W(.05)} 3px 4px)`,
  basalt: `radial-gradient(circle, ${K(.35)} 0 1.2px, transparent 1.8px) 0 0/6px 6px, radial-gradient(circle, ${W(.14)} 0 .8px, transparent 1.4px) 2px 3px/5px 5px, linear-gradient(135deg, ${W(.12)}, transparent 55%)`,
  glass: `linear-gradient(135deg, ${W(.55)} 0 16%, transparent 17% 58%, ${W(.2)} 59% 65%, transparent 66%), radial-gradient(circle at 50% 50%, ${W(.28)}, transparent 62%)`,
  rust: `radial-gradient(circle at 17% 17%, ${W(.4)} 0 1.4px, ${K(.45)} 1.9px 2.6px, transparent 3px), radial-gradient(circle at 83% 17%, ${W(.4)} 0 1.4px, ${K(.45)} 1.9px 2.6px, transparent 3px), radial-gradient(circle at 17% 83%, ${W(.4)} 0 1.4px, ${K(.45)} 1.9px 2.6px, transparent 3px), radial-gradient(circle at 83% 83%, ${W(.4)} 0 1.4px, ${K(.45)} 1.9px 2.6px, transparent 3px), radial-gradient(ellipse at 30% 70%, ${K(.22)}, transparent 50%), radial-gradient(ellipse at 72% 30%, ${W(.14)}, transparent 45%)`,
  spray: `radial-gradient(circle at 70% 28%, ${W(.35)}, transparent 36%), radial-gradient(circle at 25% 75%, ${K(.2)}, transparent 42%), linear-gradient(90deg, transparent 58%, ${K(.2)} 58% 66%, transparent 66%) 0 100%/100% 45% no-repeat`,
  hazard: `repeating-linear-gradient(45deg, ${K(.82)} 0 5px, transparent 5px 11px), linear-gradient(180deg, ${W(.18)}, transparent 50%)`,
  tape: `linear-gradient(180deg, transparent 38%, ${W(.82)} 38% 52%, transparent 52%), ${speck(.1, .1)}`,
  speck: speck()
};
const SH = `inset 0 2px 0 ${W(.35)}, inset 0 -3px 0 ${K(.28)}, 0 2px 3px ${K(.25)}`;
const SH_GLASS = `inset 0 0 0 2px ${W(.6)}, inset 0 0 0 4px ${K(.08)}, inset 0 -3px 0 ${K(.12)}, 0 2px 4px ${K(.18)}`;
const SH_NIGHT = `${SH}, 0 0 10px rgba(242,194,27,.28)`;
const E_LIGHT = `inset 0 2px 3px ${K(.14)}, inset 0 0 0 1.5px ${K(.12)}`;
const E_DARK = `inset 0 2px 4px ${K(.45)}, inset 0 0 0 1.5px ${W(.08)}`;
export const THEMES: Theme[] = [
  { name: 'Red clay brick', base: '#f5ead8', page: 'radial-gradient(circle at 96% 2%, #f0c9a8 0 220px, transparent 221px), radial-gradient(circle at 2% 100%, #d9dfc9 0 200px, transparent 201px), #f5ead8',
    board: `${speck(.25, .1)}, #d9c6a8`, empty: `${speck(.5, .06)}, #faf3e7`, esh: E_LIGHT, sh: SH, ink: '#201e1d', sub: '#6b5f55', tray: 'rgba(236,222,200,.72)', accent: '#7a8a5e', crack: '#1c1a19', label: ['#9c4f22', '#f5ead8'], dust: ['#cbb9a0', '#e2d4bf', '#a8937a'],
    blocks: [['#b5532a', '#7c3317', 'brick'], ['#d0733f', '#93461f', 'brick'], ['#8c3a22', '#5a2212', 'brick'], ['#5d3b31', '#3a221b', 'brick'], ['#d8a268', '#9c6a36', 'brick']] },
  { name: 'Sandstone heritage', base: '#f3ead3', page: 'radial-gradient(circle at 96% 2%, #edd9a8 0 220px, transparent 221px), linear-gradient(rgba(140,100,40,.07) 2px, transparent 2px) 0 0/100% 64px, #f3ead3',
    board: `${speck(.25, .1)}, #cdb68a`, empty: `${speck(.5, .06)}, #fbf5e6`, esh: E_LIGHT, sh: SH, ink: '#2b2418', sub: '#6f604a', tray: 'rgba(230,214,180,.6)', accent: '#a8743a', crack: '#2b2418', label: ['#8a5a22', '#f3ead3'], dust: ['#e0cb9c', '#cdb07a', '#f0e2bf'],
    blocks: [['#d9a95b', '#9c7131', 'strata'], ['#c48a3f', '#8a5c22', 'strata'], ['#c98a6b', '#8d5a42', 'strata'], ['#a8743a', '#6f4a22', 'strata'], ['#b99a5e', '#7e663a', 'strata']] },
  { name: 'Concrete block', base: '#ebe8e3', page: 'linear-gradient(rgba(0,0,0,.05) 3px, transparent 3px) 0 0/100% 90px, linear-gradient(90deg, rgba(0,0,0,.05) 3px, transparent 3px) 0 0/180px 100%, #ebe8e3',
    board: `${speck(.1, .2)}, #8f8a84`, empty: `${speck(.4, .08)}, #f2f0ec`, esh: E_LIGHT, sh: SH, ink: '#1f1e1c', sub: '#5f5b56', tray: 'rgba(210,206,200,.6)', accent: '#c67139', crack: '#1f1e1c', label: ['#c35f24', '#ebe8e3'], dust: ['#b8b3ab', '#d4d0c9', '#8f8a84'],
    blocks: [['#9a958e', '#6a665f', 'besser'], ['#7d7872', '#55514c', 'besser'], ['#b0aba3', '#7c7870', 'besser'], ['#5f5b56', '#3d3a37', 'besser'], ['#c7743f', '#8a4c26', 'besser']] },
  { name: 'Rendered & painted', base: '#faf6ef', page: 'radial-gradient(circle at 94% 6%, #f1cdb5 0 200px, transparent 201px), radial-gradient(circle at 6% 94%, #cfdbe6 0 220px, transparent 221px), radial-gradient(circle at 80% 90%, #e6ecd6 0 120px, transparent 121px), #faf6ef',
    board: `${speck(.4, .05)}, #e6ddd0`, empty: `${speck(.5, .04)}, #fffdf9`, esh: E_LIGHT, sh: SH, ink: '#201e1d', sub: '#6b625a', tray: 'rgba(240,232,220,.75)', accent: '#5b7a99', crack: '#201e1d', label: ['#c35f24', '#faf6ef'], dust: ['#f1ebe2', '#ddd3c5', '#c9bfb0'],
    blocks: [['#c67139', '#8e4d23', 'paint'], ['#7a8a5e', '#515d3d', 'paint'], ['#5b7a99', '#3d556c', 'paint'], ['#d9a441', '#9c7428', 'paint'], ['#b5657a', '#7d4453', 'paint']] },
  { name: 'Bluestone', base: '#1d2227', dark: true, page: 'linear-gradient(rgba(255,255,255,.035) 3px, transparent 3px) 0 0/100% 110px, linear-gradient(90deg, rgba(255,255,255,.035) 3px, transparent 3px) 0 0/220px 100%, radial-gradient(ellipse at 50% 0%, #34404a, #1d2227 70%)',
    board: `${speck(.06, .3)}, #12161a`, empty: `${speck(.05, .2)}, #2a3138`, esh: E_DARK, sh: SH, ink: '#eef1f3', sub: '#a4afb9', tray: 'rgba(255,255,255,.06)', accent: '#8fa3b5', crack: '#090b0d', label: ['#e7edf2', '#12161a'], dust: ['#5d6873', '#7b8792', '#3e4750'],
    blocks: [['#7b8997', '#4f5b66', 'basalt'], ['#65737f', '#414c55', 'basalt'], ['#97a5b2', '#66737e', 'basalt'], ['#56636f', '#38414a', 'basalt'], ['#a89f8f', '#71695c', 'basalt']] },
  { name: 'Glass block', base: '#e4eeee', page: 'linear-gradient(115deg, rgba(255,255,255,.55) 0 18%, transparent 18% 38%, rgba(255,255,255,.35) 38% 46%, transparent 46%), radial-gradient(circle at 90% 10%, #cfe6e4 0 220px, transparent 221px), #e4eeee',
    board: 'linear-gradient(135deg, #c3d0d0, #a9b8b8)', empty: `${speck(.6, .03)}, #f4f8f8`, esh: E_LIGHT, sh: SH_GLASS, ink: '#1c2a2e', sub: '#50686e', tray: 'rgba(255,255,255,.45)', accent: '#5f8f9c', crack: '#1c2a2e', label: ['#2f6f80', '#f4f8f8'], dust: ['#ffffff', '#d6e7ea', '#b9d3d8'],
    blocks: [['#7fb7c4', '#4d8593', 'glass'], ['#9fcfb8', '#5f9a7f', 'glass'], ['#6d9fd1', '#3f6f9f', 'glass'], ['#8fa6d8', '#5b6fa6', 'glass'], ['#5f8f9c', '#3b6571', 'glass']] },
  { name: 'Rust & brick', base: '#2a2320', dark: true, page: 'repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 16px, rgba(0,0,0,.14) 16px 32px), radial-gradient(ellipse at 20% 100%, rgba(176,85,42,.35), transparent 60%), #2a2320',
    board: `repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 2px, transparent 2px 6px), #1a1614`, empty: `${speck(.05, .2)}, #3a322e`, esh: E_DARK, sh: SH, ink: '#f3e9e1', sub: '#bba999', tray: 'rgba(255,255,255,.05)', accent: '#c9782f', crack: '#0d0a09', label: ['#f0a45a', '#1a1614'], dust: ['#7a5a46', '#9b6d4c', '#4d3a30'],
    blocks: [['#b0552a', '#6f3216', 'rust'], ['#8a4323', '#55260f', 'rust'], ['#8e4a34', '#5a2c1f', 'brick'], ['#8c8279', '#5a524b', 'rust'], ['#c9782f', '#86491a', 'rust']] },
  { name: 'Laneway graffiti', base: '#231f26', dark: true, page: 'radial-gradient(circle at 12% 18%, rgba(255,79,154,.35) 0 120px, transparent 180px), radial-gradient(circle at 88% 30%, rgba(53,208,224,.28) 0 110px, transparent 170px), radial-gradient(circle at 70% 92%, rgba(182,227,53,.25) 0 130px, transparent 190px), #231f26',
    board: 'linear-gradient(rgba(0,0,0,.35) 2px, transparent 2px) 0 0/100% 18px, #4a2f2a', empty: `${speck(.05, .2)}, #3b302d`, esh: E_DARK, sh: SH, ink: '#ffffff', sub: '#cfc5d4', tray: 'rgba(255,255,255,.06)', accent: '#ff4f9a', crack: '#140f12', label: ['#ffcf33', '#231f26'], dust: ['#ff4f9a', '#35d0e0', '#b6e335'],
    blocks: [['#ff4f9a', '#b02a66', 'spray'], ['#35d0e0', '#1a8b98', 'spray'], ['#b6e335', '#76991a', 'spray'], ['#ffcf33', '#b58c12', 'spray'], ['#ff7a2e', '#b44d13', 'spray']] },
  { name: 'Night site', base: '#12151a', dark: true, page: 'radial-gradient(ellipse 70% 45% at 50% -5%, rgba(255,214,120,.28), transparent 70%), repeating-linear-gradient(45deg, transparent 0 60px, rgba(242,194,27,.05) 60px 80px), #12151a',
    board: 'radial-gradient(ellipse at 50% 0%, rgba(255,214,120,.2), transparent 65%), #0e1013', empty: `${speck(.05, .2)}, #23272e`, esh: E_DARK, sh: SH_NIGHT, ink: '#f5f1e6', sub: '#aeb3ba', tray: 'rgba(255,255,255,.05)', accent: '#f2c21b', crack: '#0a0b0d', label: ['#f2c21b', '#12151a'], dust: ['#8a8f96', '#b9bdc2', '#5a5f66'],
    blocks: [['#f2c21b', '#a8830c', 'hazard'], ['#ff8a1f', '#b35a0c', 'tape'], ['#9aa2ab', '#646b73', 'speck'], ['#6a727c', '#454b53', 'speck'], ['#d9542b', '#952f14', 'tape']] }
];
export const NT = THEMES.length;
export const HOT = '#e0582f';
export const PROG = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
export const KEYS = [0, 2, -2, 3, -3, 5, -4, 1, 4];
export const fmt = (v: number) => Number(v).toLocaleString('en-AU');
export const mf = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
