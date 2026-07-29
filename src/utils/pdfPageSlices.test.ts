import { describe, expect, it } from 'vitest';
import { computeBodyPageSlices, pickSafeCut } from '@/utils/pdfPageSlices';
import { buildTwoPageDemoInvoiceItems } from '@/utils/twoPageDemoInvoice';

describe('pdfPageSlices', () => {
  it('fits a short body on a single last page', () => {
    const slices = computeBodyPageSlices(800, 1800, 1400, [200, 400, 800]);
    expect(slices).toEqual([800]);
  });

  it('never puts overflowing remainder on the last middle page (total-clip bug)', () => {
    // Reproduce INV-2026-0010 style: body taller than last-page capacity but
    // shorter than middle-page capacity. Old logic consumed everything on page 1
    // then drew footer on top — clipping Total Amount below the page.
    const bodyHeight = 2000;
    const midAvail = 2200; // middle page can "fit" the whole body
    const lastAvail = 1500; // but with footer reserved it cannot
    const safeCuts = [];
    for (let y = 100; y <= bodyHeight; y += 100) safeCuts.push(y);

    const slices = computeBodyPageSlices(bodyHeight, midAvail, lastAvail, safeCuts);

    expect(slices.length).toBeGreaterThanOrEqual(2);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(bodyHeight);
    // Last slice must fit within footer-reserved capacity
    expect(slices[slices.length - 1]).toBeLessThanOrEqual(lastAvail);
    // No middle slice may consume the entire remaining body when overflow would occur
    expect(slices[0]).toBeLessThan(bodyHeight);
  });

  it('creates a demo 2-page invoice split where total block stays on last page', () => {
    // Simulate many line-item rows (~40px each) then a Total Amount section at the end
    const rowH = 40;
    const itemRows = 45; // enough to force 2+ pages
    const totalBlockH = 80; // Total Amount + In Word
    const safeCuts: number[] = [];
    for (let i = 1; i <= itemRows; i++) safeCuts.push(i * rowH);
    const totalBottom = itemRows * rowH + totalBlockH;
    safeCuts.push(totalBottom);

    const midAvail = 1600;
    const lastAvail = 1200;
    const slices = computeBodyPageSlices(totalBottom, midAvail, lastAvail, safeCuts);

    expect(slices.length).toBeGreaterThanOrEqual(2);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(totalBottom);

    // The Total Amount bottom (totalBottom) must land on the last page slice
    let start = 0;
    for (let i = 0; i < slices.length; i++) {
      const end = start + slices[i];
      if (i === slices.length - 1) {
        expect(end).toBe(totalBottom);
        expect(start).toBeLessThan(totalBottom);
        // total block starts after last item row
        const totalStart = itemRows * rowH;
        expect(start).toBeLessThanOrEqual(totalStart);
        expect(end - start).toBeLessThanOrEqual(lastAvail);
      }
      start = end;
    }
  });

  it('demo invoice builder has enough rows to span two pages and a real total', () => {
    const demo = buildTwoPageDemoInvoiceItems(35);
    expect(demo.items.length).toBeGreaterThan(40);
    expect(demo.totalAmount).toBe(6716830);
    expect(demo.invoiceNumber).toContain('DEMO');
  });

  it('pickSafeCut prefers the largest row boundary within the limit', () => {
    const cuts = [100, 200, 300, 450, 600];
    expect(pickSafeCut(0, 320, 600, cuts)).toBe(300);
    expect(pickSafeCut(300, 200, 300, cuts)).toBe(450);
  });
});
