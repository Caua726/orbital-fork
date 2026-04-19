import { describe, it, expect } from 'vitest';
import {
  distance, midpoint, isTap, isDoubleTap,
  TAP_MAX_MOVE, TAP_MAX_DURATION_MS, DBL_TAP_MAX_GAP_MS, DBL_TAP_MAX_DIST,
} from '../pointer-gestures';

describe('pointer-gestures', () => {
  it('distance', () => {
    expect(distance({x:0,y:0},{x:3,y:4})).toBe(5);
  });

  it('midpoint', () => {
    expect(midpoint({x:0,y:0},{x:10,y:20})).toEqual({x:5,y:10});
  });

  it('isTap: short + small move', () => {
    expect(isTap({dist: TAP_MAX_MOVE - 1, duration: TAP_MAX_DURATION_MS - 1})).toBe(true);
  });

  it('isTap: too much move', () => {
    expect(isTap({dist: TAP_MAX_MOVE + 1, duration: 50})).toBe(false);
  });

  it('isTap: too long', () => {
    expect(isTap({dist: 1, duration: TAP_MAX_DURATION_MS + 1})).toBe(false);
  });

  it('isDoubleTap: close in time and space', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1000 + DBL_TAP_MAX_GAP_MS - 1, x: 110, y: 100 })).toBe(true);
  });

  it('isDoubleTap: too far in time', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1000 + DBL_TAP_MAX_GAP_MS + 1, x: 100, y: 100 })).toBe(false);
  });

  it('isDoubleTap: too far in space', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1100, x: 100 + DBL_TAP_MAX_DIST + 1, y: 100 })).toBe(false);
  });

  it('isDoubleTap: null prev', () => {
    expect(isDoubleTap(null, { time: 1000, x: 100, y: 100 })).toBe(false);
  });
});
