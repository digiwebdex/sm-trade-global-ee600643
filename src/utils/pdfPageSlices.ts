/**
 * Row-aware PDF body page slicing.
 * Ensures the last page always reserves space for the footer so totals
 * at the bottom of the body are never clipped off the page.
 */

export function pickSafeCut(
  startPx: number,
  maxPx: number,
  remainingPx: number,
  safeCuts: number[],
): number {
  const limit = startPx + maxPx;
  let best = -1;
  for (const c of safeCuts) {
    if (c <= startPx) continue;
    if (c <= limit) {
      if (c > best) best = c;
    } else {
      break;
    }
  }
  if (best === -1) {
    return startPx + Math.min(maxPx, remainingPx);
  }
  return best;
}

/**
 * Compute body pixel slices for each PDF page.
 * - Middle pages may use the full bodyAvailPx (no footer).
 * - The last page must fit within bodyAvailLastPx (footer reserved).
 * - Never consume all remaining body pixels on a middle page when they
 *   would overflow once the footer is drawn (this was clipping Total Amount).
 */
export function computeBodyPageSlices(
  bodyHeightPx: number,
  bodyAvailPx: number,
  bodyAvailLastPx: number,
  safeCuts: number[],
): number[] {
  if (bodyHeightPx <= 0) return [];
  if (bodyAvailPx <= 0) return [bodyHeightPx];

  const lastAvail = Math.max(1, bodyAvailLastPx);
  const midAvail = Math.max(1, bodyAvailPx);
  const cuts = [...safeCuts].filter((c) => c > 0 && c <= bodyHeightPx).sort((a, b) => a - b);
  if (!cuts.includes(bodyHeightPx)) cuts.push(bodyHeightPx);

  const slices: number[] = [];
  let renderedPx = 0;
  let guard = 0;

  while (renderedPx < bodyHeightPx) {
    guard += 1;
    if (guard > 50) break;

    const remainingPx = bodyHeightPx - renderedPx;

    // Fits entirely on a final page (with footer reserved)
    if (remainingPx <= lastAvail) {
      slices.push(remainingPx);
      break;
    }

    // Middle page: cut within midAvail, but NEVER take all remaining when
    // remaining does not fit with the footer — that overflows and clips totals.
    const maxThisPage = Math.min(midAvail, remainingPx - 1);
    let cutAt = pickSafeCut(renderedPx, maxThisPage, remainingPx, cuts);
    let thisSlicePx = cutAt - renderedPx;

    if (thisSlicePx <= 0) {
      thisSlicePx = Math.min(maxThisPage, remainingPx - 1);
    }
    // Still taking everything? Force leave at least 1px for next page.
    if (thisSlicePx >= remainingPx) {
      thisSlicePx = Math.max(1, Math.min(midAvail, remainingPx - 1));
    }

    slices.push(thisSlicePx);
    renderedPx += thisSlicePx;
  }

  return slices;
}
