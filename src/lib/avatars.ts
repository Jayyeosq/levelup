// Avatars you earn by playing, plus a background colour behind each one.
// Stored in profiles.avatar as "<emoji>|<colour key>" (just "<emoji>" = no colour),
// so every screen and server function that already passes `avatar` around keeps working.
import { titleOf, TITLES } from './game';

export type AvatarRule =
  | { kind: 'free' }
  | { kind: 'level'; level: number }
  | { kind: 'badge'; badge: string; name: string }
  | { kind: 'king' };
export type AvatarDef = { emoji: string; rule: AvatarRule };

const lv = (title: string): AvatarRule => ({ kind: 'level', level: TITLES.find((t) => t[1] === title)![0] });

export const AVATARS: AvatarDef[] = [
  // Everyone starts with these
  { emoji: '🏃', rule: { kind: 'free' } },
  { emoji: '🏃‍♀️', rule: { kind: 'free' } },
  { emoji: '🦊', rule: { kind: 'free' } },
  { emoji: '🐼', rule: { kind: 'free' } },
  { emoji: '🐢', rule: { kind: 'free' } },
  // Titles
  { emoji: '🐯', rule: lv('Jogger') },
  { emoji: '🐺', rule: lv('Pacer') },
  { emoji: '🦅', rule: lv('Strider') },
  { emoji: '🐉', rule: lv('Road Warrior') },
  { emoji: '🦄', rule: lv('Legend') },
  // Badges
  { emoji: '⚡', rule: { kind: 'badge', badge: 'k5', name: '5K Club' } },
  { emoji: '🚀', rule: { kind: 'badge', badge: 'k10', name: 'Double Digits' } },
  { emoji: '🏅', rule: { kind: 'badge', badge: 'half', name: 'Half Marathoner' } },
  { emoji: '🔥', rule: { kind: 'badge', badge: 's3', name: 'On Fire' } },
  { emoji: '🌅', rule: { kind: 'badge', badge: 'early', name: 'Sunrise Runner' } },
  { emoji: '🦁', rule: { kind: 'badge', badge: 'land', name: 'Land Grabber' } },
  { emoji: '🧭', rule: { kind: 'badge', badge: 'explorer', name: 'Explorer' } },
  // Territory
  { emoji: '👑', rule: { kind: 'king' } },
];

/** Background colours: deep tones so the emoji stays the focus on the dark theme. */
export const AVATAR_COLORS: { key: string; color: string; name: string }[] = [
  { key: 'none', color: '#1E2128', name: 'Graphite' },
  { key: 'orange', color: '#7A3415', name: 'Orange' },
  { key: 'red', color: '#6E1F28', name: 'Red' },
  { key: 'pink', color: '#6B2150', name: 'Pink' },
  { key: 'purple', color: '#46306E', name: 'Purple' },
  { key: 'blue', color: '#1F3E6E', name: 'Blue' },
  { key: 'teal', color: '#14504D', name: 'Teal' },
  { key: 'green', color: '#1F5233', name: 'Green' },
  { key: 'gold', color: '#6B5413', name: 'Gold' },
];

export function parseAvatar(v?: string | null): { emoji: string; key: string; color: string } {
  const [emoji, key = 'none'] = (v || '🏃').split('|');
  const c = AVATAR_COLORS.find((x) => x.key === key) ?? AVATAR_COLORS[0];
  return { emoji: emoji || '🏃', key: c.key, color: c.color };
}
export const formatAvatar = (emoji: string, key: string) => (key && key !== 'none' ? `${emoji}|${key}` : emoji);
/** Just the emoji, for places that show the avatar inside a line of text. */
export const emojiOf = (v?: string | null) => parseAvatar(v).emoji;

export type UnlockContext = { level: number; badges: Record<string, number>; isKing: boolean };

export function isUnlocked(a: AvatarDef, c: UnlockContext): boolean {
  const r = a.rule;
  if (r.kind === 'free') return true;
  if (r.kind === 'level') return c.level >= r.level;
  if (r.kind === 'badge') return !!c.badges[r.badge];
  return c.isKing;
}

export function unlockHint(a: AvatarDef): string {
  const r = a.rule;
  if (r.kind === 'level') return `Reach ${titleOf(r.level)} (level ${r.level}) to unlock`;
  if (r.kind === 'badge') return `Earn the ${r.name} badge to unlock`;
  if (r.kind === 'king') return 'Become King of a town to unlock';
  return '';
}

/** Avatars a run (or a batch of synced runs) just unlocked. King unlocks aren't known here. */
export function newlyUnlocked(levelBefore: number, levelAfter: number, newBadgeIds: string[]): AvatarDef[] {
  return AVATARS.filter((a) => {
    const r = a.rule;
    if (r.kind === 'level') return levelBefore < r.level && levelAfter >= r.level;
    if (r.kind === 'badge') return newBadgeIds.includes(r.badge);
    return false;
  });
}
