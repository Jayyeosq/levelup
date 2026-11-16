// The app's accent colour. Each runner picks their own on Profile; orange is the default.
// Red, blue and yellow are left out on purpose: the Battle map uses them for
// "just lost", "within reach" and "under attack".
export type Accent = { key: string; name: string; color: string; on: string; attack: string };

export const ACCENTS: Accent[] = [
  { key: 'orange',  name: 'Orange',  color: '#FF6A2B', on: '#1A0F08', attack: 'rgba(250,204,21,1)' },
  { key: 'violet',  name: 'Violet',  color: '#A78BFA', on: '#160F2E', attack: 'rgba(250,204,21,1)' },
  { key: 'teal',    name: 'Teal',    color: '#2DD4BF', on: '#04201C', attack: 'rgba(250,204,21,1)' },
  { key: 'fuchsia', name: 'Fuchsia', color: '#E879F9', on: '#2A0A30', attack: 'rgba(250,204,21,1)' },
  // Lime sits too close to yellow, so its "under attack" outline is white.
  { key: 'lime',    name: 'Lime',    color: '#C6F432', on: '#1B2104', attack: 'rgba(255,255,255,1)' },
];
export const DEFAULT_ACCENT = 'orange';

let current: Accent = ACCENTS[0];

export const accentOf = (key?: string | null): Accent => ACCENTS.find((a) => a.key === key) ?? ACCENTS[0];
export const getAccent = (): Accent => current;
export function setAccent(key?: string | null) { current = accentOf(key); }

/** The current accent as an rgba() string, for map tiles and tints. */
export function accentRgba(alpha: number): string {
  const h = current.color;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${alpha})`;
}
