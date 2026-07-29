import { describe, expect, it } from 'vitest';
import { computeBodyPageSlices, pickSafeCut, cutSplitsKeep } from '@/utils/pdfPageSlices';

describe('pdfPageSlices', () => {
  it('fits a short body on a single last page', () => {
    const slices = computeBodyPageSlices(800, 1800, 1400, [200, 400, 800]);
    expect(slices).toEqual([800]);
  });

  it('never puts overflowing remainder on the last middle page (total-clip bug)', () => {
    const bodyHeight = 2000;
    const midAvail = 2200;
    const lastAvail = 1500;
    const safeCuts = [];
    for (let y = 100; y <= bodyHeight; y += 100) safeCuts.push(y);

    const slices = computeBodyPageSlices(bodyHeight, midAvail, lastAvail, safeCuts);

    expect(slices.length).toBeGreaterThanOrEqual(2);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(bodyHeight);
    expect(slices[slices.length - 1]).toBeLessThanOrEqual(lastAvail);
    expect(slices[0]).toBeLessThan(bodyHeight);
  });

  it('keeps Total Amount block together and on last page', () => {
    const rowH = 40;
    const itemRows = 45;
    const totalStart = itemRows * rowH;
    const totalEnd = totalStart + 80;
    const safeCuts: number[] = [];
    for (let i = 1; i <= itemRows; i++) safeCuts.push(i * rowH);
    safeCuts.push(totalEnd);

    const slices = computeBodyPageSlices(totalEnd, 1600, 1200, safeCuts, [
      { start: totalStart, end: totalEnd },
    ]);

    expect(slices.reduce((a, b) => a + b, 0)).toBe(totalEnd);
    expect(slices.length).toBeGreaterThanOrEqual(2);

    // No slice boundary may fall strictly inside the totals block
    let start = 0;
    for (const size of slices.slice(0, -1)) {
      const cut = start + size;
      expect(cutSplitsKeep(cut, start, [{ start: totalStart, end: totalEnd }])).toBe(false);
      start = cut;
    }
    // Last page includes the total end
    expect(start + slices[slices.length - 1]).toBe(totalEnd);
    expect(start).toBeLessThanOrEqual(totalStart);
  });

  it('pickSafeCut prefers the largest row boundary within the limit', () => {
    const cuts = [100, 200, 300, 450, 600];
    expect(pickSafeCut(0, 320, 600, cuts)).toBe(300);
    expect(pickSafeCut(300, 200, 300, cuts)).toBe(450);
  });
});
