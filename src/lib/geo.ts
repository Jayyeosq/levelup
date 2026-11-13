// Geometry helpers: distance + the hex grid used for territory tiles.
// The grid is anchored on Singapore so every phone (and later the server)
// computes exactly the same tile IDs for the same spot.

export type LatLng = { latitude: number; longitude: number };

const R_EARTH = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ---------- Hex grid (pointy-top, ~156 m across) ----------
const ORIGIN = { latitude: 1.3521, longitude: 103.8198 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320 * Math.cos(toRad(ORIGIN.latitude));
export const HEX_RADIUS_M = 90;
const SQRT3 = Math.sqrt(3);

function toXY(p: LatLng) {
  return {
    x: (p.longitude - ORIGIN.longitude) * M_PER_DEG_LNG,
    y: (p.latitude - ORIGIN.latitude) * M_PER_DEG_LAT,
  };
}
function toLatLng(x: number, y: number): LatLng {
  return { latitude: ORIGIN.latitude + y / M_PER_DEG_LAT, longitude: ORIGIN.longitude + x / M_PER_DEG_LNG };
}

/** Tile ID ("q:r") of the hex containing a point. */
export function tileOf(p: LatLng): string {
  const { x, y } = toXY(p);
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / HEX_RADIUS_M;
  const rf = ((2 / 3) * y) / HEX_RADIUS_M;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return `${q}:${r}`;
}

export function tileCenter(id: string): LatLng {
  const [q, r] = id.split(':').map(Number);
  return toLatLng(HEX_RADIUS_M * SQRT3 * (q + r / 2), HEX_RADIUS_M * 1.5 * r);
}

/** Six corners of a tile, for drawing it on the map. */
export function tilePolygon(id: string): LatLng[] {
  const [q, r] = id.split(':').map(Number);
  const cx = HEX_RADIUS_M * SQRT3 * (q + r / 2);
  const cy = HEX_RADIUS_M * 1.5 * r;
  const pts: LatLng[] = [];
  for (let i = 0; i < 6; i++) {
    const a = toRad(60 * i - 30);
    pts.push(toLatLng(cx + HEX_RADIUS_M * 0.96 * Math.cos(a), cy + HEX_RADIUS_M * 0.96 * Math.sin(a)));
  }
  return pts;
}

/**
 * Split a route into per-tile distance (km). Each segment's length goes to the
 * tile its midpoint falls in. Long segments are sub-divided so no tile is skipped.
 */
export function kmPerTile(route: LatLng[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const d = distanceM(a, b);
    const parts = Math.max(1, Math.ceil(d / 40));
    for (let k = 0; k < parts; k++) {
      const t = (k + 0.5) / parts;
      const mid = { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
      const id = tileOf(mid);
      out[id] = (out[id] || 0) + d / parts / 1000;
    }
  }
  return out;
}

// ---------- Areas (approximate town centres, nearest wins) ----------
export const TOWNS: [string, number, number][] = [
  ['Ang Mo Kio', 1.3691, 103.8454], ['Bedok', 1.3236, 103.9273], ['Bishan', 1.3508, 103.8485],
  ['Bukit Batok', 1.359, 103.7637], ['Bukit Merah', 1.2819, 103.8239], ['Bukit Panjang', 1.3774, 103.7719],
  ['Bukit Timah', 1.3294, 103.8021], ['Choa Chu Kang', 1.384, 103.747], ['Clementi', 1.3162, 103.7649],
  ['Geylang', 1.3201, 103.8918], ['Hougang', 1.3612, 103.8863], ['Jurong East', 1.3329, 103.7436],
  ['Jurong West', 1.3404, 103.709], ['Kallang', 1.31, 103.8651], ['Marine Parade', 1.302, 103.9072],
  ['Pasir Ris', 1.3721, 103.9474], ['Punggol', 1.3984, 103.9072], ['Queenstown', 1.2942, 103.7861],
  ['Sembawang', 1.4491, 103.8185], ['Sengkang', 1.3868, 103.8914], ['Serangoon', 1.3554, 103.8679],
  ['Tampines', 1.3496, 103.9568], ['Toa Payoh', 1.3343, 103.8563], ['Woodlands', 1.4382, 103.789],
  ['Yishun', 1.4304, 103.8354], ['Downtown', 1.284, 103.851],
];
const areaCache: Record<string, string> = {};
export function areaOfTile(id: string): string {
  if (areaCache[id]) return areaCache[id];
  const c = tileCenter(id);
  let best = 'Singapore', bd = Infinity;
  for (const [n, la, ln] of TOWNS) {
    const d = (la - c.latitude) ** 2 + ((ln - c.longitude) * Math.cos(toRad(la))) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  // Beyond ~6 km from any town centre we just call it "Singapore"/overseas.
  if (Math.sqrt(bd) * M_PER_DEG_LAT > 6000) best = 'Outside SG towns';
  return (areaCache[id] = best);
}

/** Keep roughly one point per `minM` metres so stored routes stay small. */
export function simplify(route: LatLng[], minM = 15): LatLng[] {
  if (route.length < 3) return route.slice();
  const out = [route[0]];
  for (let i = 1; i < route.length - 1; i++) {
    if (distanceM(out[out.length - 1], route[i]) >= minM) out.push(route[i]);
  }
  out.push(route[route.length - 1]);
  return out.map((p) => ({ latitude: +p.latitude.toFixed(6), longitude: +p.longitude.toFixed(6) }));
}

/** Decodes a Google-encoded polyline (the format Strava uses for routes). */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
}

/** Splits a stored route wherever two points are far apart (a pause), so no line is drawn across the gap. */
export function splitAtGaps(route: LatLng[], gapM = 200): LatLng[][] {
  const out: LatLng[][] = [];
  let cur: LatLng[] = [];
  for (const p of route) {
    if (cur.length && distanceM(cur[cur.length - 1], p) > gapM) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
