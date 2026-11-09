// Area Battle: the shared territory map. All data comes from server functions
// in 0003_territory.sql, which only return usernames and km totals — never routes,
// and never tiles near where anyone's runs start or end.
import { supabase } from './supabase';

export type BattleTile = {
  tile_id: string; owner_id: string; username: string; avatar: string;
  owner_km: number; my_km: number; contenders: number; is_mine: boolean;
};
export type MyTile = { tile_id: string; my_km: number; owner_id: string; owner_username: string; owner_km: number };
export type TownKing = {
  town: string; king_id: string; king_username: string; king_avatar: string;
  king_tiles: number; my_tiles: number; total_tiles: number;
};
export type Box = { minLat: number; minLng: number; maxLat: number; maxLng: number };

const nums = <T,>(rows: any[], keys: (keyof T)[]): T[] =>
  rows.map((r) => { const o = { ...r }; for (const k of keys) o[k] = Number(o[k]); return o as T; });

export async function fetchTerritory(b: Box): Promise<BattleTile[]> {
  const { data, error } = await supabase.rpc('territory_in_box', { min_lat: b.minLat, min_lng: b.minLng, max_lat: b.maxLat, max_lng: b.maxLng });
  if (error) throw error;
  return nums<BattleTile>(data ?? [], ['owner_km', 'my_km', 'contenders']);
}

export async function fetchMyTiles(): Promise<MyTile[]> {
  const { data, error } = await supabase.rpc('my_tiles');
  if (error) throw error;
  return nums<MyTile>(data ?? [], ['my_km', 'owner_km']);
}

export async function fetchKings(): Promise<TownKing[]> {
  const { data, error } = await supabase.rpc('town_kings');
  if (error) throw error;
  return nums<TownKing>(data ?? [], ['king_tiles', 'my_tiles', 'total_tiles']);
}

/** Stable colour per rival, from a small palette (you are always orange). */
const RIVAL = ['#4C9AFF', '#A78BFA', '#2DD4BF', '#F472B6', '#FACC15', '#60A5FA', '#34D399', '#F87171'];
export function rivalColor(userId: string) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return RIVAL[h % RIVAL.length];
}
export const hexToRgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
