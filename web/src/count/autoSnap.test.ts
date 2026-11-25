import { describe, expect, it } from 'vitest';
import { FRAME_SIDE, brightness, createSteadyWatcher, difference, sharpness, toGrey } from './autoSnap';

const SIZE = FRAME_SIDE * FRAME_SIDE;

/** A shelf-like picture: bright background with dark upright bars, shifted sideways by `shift` pixels. */
function scene(shift = 0, bars = 6, background = 190): Uint8Array {
  const grey = new Uint8Array(SIZE).fill(background);
  const pitch = Math.floor(FRAME_SIDE / bars);
  for (let y = 12; y < 56; y++) {
    for (let x = 0; x < FRAME_SIDE; x++) {
      if ((((x + shift) % pitch) + pitch) % pitch < pitch / 2) grey[y * FRAME_SIDE + x] = 50;
    }
  }
  return grey;
}
const blank = (value: number) => new Uint8Array(SIZE).fill(value);

/** Feeds looks 160 ms apart and returns the times at which a photo was taken. */
function watch(frames: Uint8Array[], watcher = createSteadyWatcher(0), from = 0): number[] {
  const snaps: number[] = [];
  frames.forEach((frame, index) => {
    const now = from + index * 160;
    if (watcher.look(frame, now).snap) snaps.push(now);
  });
  return snaps;
}
const repeat = (frame: Uint8Array, times: number) => new Array<Uint8Array>(times).fill(frame);

describe('measuring a look', () => {
  it('tells a steady view from a moved one, a sharp one from a blank one, and light from dark', () => {
    expect(difference(scene(), scene())).toBe(0);
    expect(difference(scene(), scene(3))).toBeGreaterThan(18);
    expect(sharpness(scene())).toBeGreaterThan(2.5);
    expect(sharpness(blank(150))).toBe(0);
    expect(brightness(blank(10))).toBe(10);
    expect([...toGrey(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0]);
  });
});

describe('taking the count photo by itself', () => {
  it('takes one photo once the view has been steady for a moment, and no second one of the same view', () => {
    const snaps = watch(repeat(scene(), 40));
    expect(snaps).toHaveLength(1);
    // Not before the pause after opening (1 s), nor before 0.8 s of steadiness.
    expect(snaps[0]).toBeGreaterThanOrEqual(1000);
    expect(snaps[0]).toBeLessThan(2000);
  });

  it('waits while the phone is moving, the view is blank, or it is too dark', () => {
    const moving = Array.from({ length: 30 }, (_, index) => scene(index * 3));
    expect(watch(moving)).toEqual([]);
    expect(watch(repeat(blank(150), 30))).toEqual([]);
    expect(watch(repeat(scene(0, 6, 20).map((value) => Math.min(value, 20)), 30))).toEqual([]);
  });

  it('takes the next photo only after the phone has moved on to a different view and steadied again', () => {
    const watcher = createSteadyWatcher(0);
    const first = watch(repeat(scene(), 20), watcher);
    expect(first).toHaveLength(1);

    // The same stock with the flicker a camera adds to every frame is not a new view.
    const shaky = Array.from({ length: 20 }, (_, index) => scene().map((value) => value + (index % 2 === 0 ? 3 : -3)));
    expect(watch(shaky, watcher, 4000)).toEqual([]);

    // Another product: a different picture, held steady.
    const next = watch(repeat(scene(0, 3, 120), 20), watcher, 8000);
    expect(next).toHaveLength(1);
  });

  it('does not retake a view whose photo was taken by hand or discarded', () => {
    const watcher = createSteadyWatcher(0);
    watcher.look(scene(), 0);
    watcher.hold();
    expect(watch(repeat(scene(), 30), watcher, 160)).toEqual([]);
  });

  it('reports how far along the steady wait is, for the ring around the button', () => {
    const watcher = createSteadyWatcher(0);
    watcher.look(scene(), 0);
    watcher.look(scene(), 160);
    const later = watcher.look(scene(), 560);
    expect(later.watch).toEqual({ kind: 'steadying', progress: 0.5 });
    expect(watcher.look(scene(5), 720).watch).toEqual({ kind: 'moving' });
  });
});
