export interface Point { x: number; y: number }

export const TAP_MAX_MOVE = 5;
export const TAP_MAX_DURATION_MS = 250;
export const DBL_TAP_MAX_GAP_MS = 300;
export const DBL_TAP_MAX_DIST = 40;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function isTap(info: { dist: number; duration: number }): boolean {
  return info.dist <= TAP_MAX_MOVE && info.duration <= TAP_MAX_DURATION_MS;
}

export interface TapRecord { time: number; x: number; y: number }

export function isDoubleTap(prev: TapRecord | null, curr: TapRecord): boolean {
  if (!prev) return false;
  const dt = curr.time - prev.time;
  const dd = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  return dt <= DBL_TAP_MAX_GAP_MS && dd <= DBL_TAP_MAX_DIST;
}
