import { describe, expect, it } from 'vitest';
import type { PreparedPhoto } from '../lib/image';
import { FRAME_SIDE } from './autoSnap';
import { createViewPicker, viewSizes, viewsThatFit } from './videoViews';

// A made-up shelf with soft edges, so that sliding the picture by one pixel changes it a little
// and by four pixels a lot, as walking around the stock does.
function look(shift: number, level = 80): Uint8Array {
  const grey = new Uint8Array(FRAME_SIDE * FRAME_SIDE);
  for (let y = 0; y < FRAME_SIDE; y++) {
    for (let x = 0; x < FRAME_SIDE; x++) {
      grey[y * FRAME_SIDE + x] = Math.round(120 + level * Math.sin((x + shift) / 6) * Math.cos(y / 9));
    }
  }
  return grey;
}

/** A picker fed with looks; each kept photo is named after the look it came from. */
function sweep(limit: number) {
  const picker = createViewPicker(limit);
  const taken: string[] = [];
  const photo = (name: string, size = 10): PreparedPhoto => ({ image: { data: name.padEnd(size, '.'), mediaType: 'image/jpeg' }, previewUrl: name });
  return {
    picker,
    taken,
    offer(name: string, grey: Uint8Array, at: number, size?: number) {
      picker.offer(grey, at, () => {
        taken.push(name);
        return photo(name, size);
      });
    },
    names: (budget = Infinity) => picker.views(budget).map((view) => view.previewUrl),
  };
}

describe('choosing views from a video taken around the stock', () => {
  it('keeps one view per angle the hand paused at, in the order they were taken', () => {
    const video = sweep(8);
    let at = 0;
    for (const [name, shift] of [['front', 0], ['left', 4], ['above', 8], ['right', 12]] as const) {
      video.offer(`reaching ${name}`, look(shift), (at += 120));   // still moving: not taken
      video.offer(name, look(shift), (at += 120));                 // paused: taken
      video.offer(`still at ${name}`, look(shift), (at += 120));   // no stiller than the one kept
    }
    expect(video.names()).toEqual(['front', 'left', 'above', 'right']);
    expect(video.taken).toEqual(['front', 'left', 'above', 'right']);
  });

  it('keeps a view of a hand that never pauses, about twice a second, so nothing is missed', () => {
    const video = sweep(8);
    // Moving the whole time: every look is a new angle, and none of them is still.
    for (let i = 0; i < 20; i++) video.offer(`look ${i}`, look(i * 4), i * 120);

    // 2.3 seconds of looks, one view about every half second: far fewer pictures than looks.
    expect(video.taken.length).toBeGreaterThanOrEqual(3);
    expect(video.taken.length).toBeLessThanOrEqual(5);
  });

  it('replaces a view with a stiller look at the same angle', () => {
    const video = sweep(8);
    for (let i = 0; i < 6; i++) video.offer(`moving ${i}`, look(i * 4), i * 120);   // one is kept while moving
    const whileMoving = video.names().at(-1);
    const shift = 5 * 4;
    video.offer('slowing', look(shift + 1), 720);    // almost the same angle, moved a little
    video.offer('still', look(shift + 1), 840);      // did not move at all
    video.offer('still too', look(shift + 1), 960);  // no stiller than 'still'

    expect(video.names().at(-1)).toBe('still');
    expect(video.names()).not.toContain(whileMoving === 'still' ? '' : 'slowing');
    expect(video.taken.at(-1)).toBe('still');
  });

  it('never keeps more than the limit: the views that look most alike are thinned first', () => {
    const video = sweep(3);
    const pause = (name: string, shift: number, at: number) => {
      video.offer(`reaching ${name}`, look(shift), at);
      video.offer(name, look(shift), at + 120);
    };
    pause('a', 0, 0);
    pause('b', 4, 300);
    pause('c', 5, 2000);   // almost the same as b, kept only because time had passed
    pause('d', 12, 2300);
    pause('e', 16, 2600);

    expect(video.picker.count()).toBe(3);
    // b and c show almost the same thing: they never both survive, and what is left is still in order.
    expect(video.names().filter((name) => name === 'b' || name === 'c').length).toBeLessThanOrEqual(1);
    expect(video.names()).toEqual([...video.names()].sort());
    expect(video.names()).toContain('e');
  });

  it('skips looks that show nothing: too dark, or a blank surface', () => {
    const video = sweep(8);
    for (let i = 0; i < 8; i++) video.offer('dark', new Uint8Array(FRAME_SIDE * FRAME_SIDE).fill(5), i * 120);
    for (let i = 8; i < 16; i++) video.offer('blank wall', new Uint8Array(FRAME_SIDE * FRAME_SIDE).fill(180), i * 120);
    expect(video.names()).toEqual([]);

    video.offer('reaching the stock', look(0), 2000);
    video.offer('stock', look(0), 2120);
    expect(video.names()).toEqual(['stock']);
  });

  it('a phone held still does not fill the video with copies of one view', () => {
    const video = sweep(8);
    for (let i = 0; i < 100; i++) video.offer(`look ${i}`, look(0), i * 120);
    expect(video.picker.count()).toBe(1);
    expect(video.taken).toHaveLength(1);
  });

  it('even stock that hardly changes still gives a new view now and then', () => {
    const video = sweep(8);
    video.offer('reaching', look(0), 0);
    video.offer('start', look(0), 120);
    // A look that differs only slightly from the view kept is not a new angle by itself.
    video.offer('a little on', look(1), 600);
    video.offer('a little on, held', look(1), 720);
    expect(video.picker.count()).toBe(1);
    // After a while it is.
    video.offer('later', look(2), 1800);
    video.offer('later, held', look(2), 1920);
    expect(video.picker.count()).toBe(2);
  });

  it('keeps views of even stock too, when the hand never pauses', () => {
    // Stock so even that, wherever the phone points, the small picture differs only a little from
    // the view kept, yet never comes to rest: every look is the same shelf with different small detail.
    const even = (seed: number): Uint8Array =>
      look(0).map((value, index) => value + ((Math.imul(index + 1, 2654435761) ^ Math.imul(seed + 1, 40503)) >>> 0) % 23 - 11);
    const video = sweep(8);
    video.offer('reaching', even(0), 0);
    video.offer('start', even(0), 120);
    for (let i = 1; i <= 100; i++) video.offer(`moving ${i}`, even(i), 120 + i * 120);

    // Twelve seconds of video: a view every second or two, not just the first.
    expect(video.picker.count()).toBeGreaterThanOrEqual(5);
  });

  it('thins the views until they fit the size that can be sent', () => {
    const video = sweep(8);
    for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) {
      video.offer(`reaching ${name}`, look(index * 4), index * 300, 400);
      video.offer(name, look(index * 4), index * 300 + 120, 400);
    }
    expect(video.picker.count()).toBe(4);
    expect(video.names(1000)).toHaveLength(2);
    // One view always goes, however large: a video is never sent as nothing.
    expect(video.names(100)).toHaveLength(1);
  });
});

describe('fitting a video into what the backend accepts in one request', () => {
  const image = (name: string, size: number) => ({ data: name.padEnd(size, '.'), mediaType: 'image/jpeg' as const });
  const names = (images: readonly { data: string }[]) => images.map((picture) => picture.data.replace(/\.+$/, ''));

  it('uses the usual sizes where the backend has room, or does not say', () => {
    expect(viewSizes(undefined)).toEqual({ budget: 3_000_000, edge: 1280 });
    expect(viewSizes(7_850_000)).toEqual({ budget: 3_000_000, edge: 1280 });
  });

  it('makes the views smaller where one request may carry little', () => {
    // A host that refuses anything over 4.5 MB: room is kept for the three detail photos.
    expect(viewSizes(4_250_000)).toEqual({ budget: 2_150_000, edge: 1024 });
    expect(viewSizes(2_000_000)).toEqual({ budget: 600_000, edge: 1024 });
  });

  it('sends every view when they fit with the detail photos', () => {
    const views = ['a', 'b', 'c', 'd'].map((name) => image(name, 100));
    expect(names(viewsThatFit(views, [image('front', 300)], 1000))).toEqual(['a', 'b', 'c', 'd']);
    expect(names(viewsThatFit(views, [], undefined))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves views out evenly when they do not, keeping the first and the last', () => {
    const views = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => image(name, 100));
    // Room for five views beside the detail photos.
    expect(names(viewsThatFit(views, [image('front', 250), image('back', 250)], 1000))).toEqual(['a', 'c', 'e', 'f', 'h']);
    // Room for two.
    expect(names(viewsThatFit(views, [image('front', 780)], 1000))).toEqual(['a', 'h']);
    // Detail photos that leave no room at all: the first view still goes, and the backend answers.
    expect(names(viewsThatFit(views, [image('front', 2000)], 1000))).toEqual(['a']);
  });
});
