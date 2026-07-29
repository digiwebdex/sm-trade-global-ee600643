/**
 * Row-aware PDF body page slicing.
 * Ensures the last page always reserves space for the footer so totals
 * at the bottom of the body are never clipped / shown as an empty bar.
 */

export type KeepRange = { start: number; end: number };

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

/** True if [a,b) overlaps the interior of a keep-together range (would split it). */
export function cutSplitsKeep(cutPx: number, startPx: number, keeps: KeepRange[]): boolean {
  for (const k of keeps) {
    if (cutPx > k.start && cutPx < k.end && startPx < k.end && startPx + 1 > k.start) {
      // cut is strictly inside the keep block
      return true;
    }
  }
  return false;
}

/**
 * Compute body pixel slices for each PDF page.
 * - Middle pages may use the full bodyAvailPx (no footer).
 * - The last page must fit within bodyAvailLastPx (footer reserved).
 * - Never consume all remaining body pixels on a middle page when they
 *   would overflow once the footer is drawn (this was clipping Total Amount).
 * - Optional keepTogether ranges (e.g. Total Amount bar) are never split mid-block.
 */
export function computeBodyPageSlices(
  bodyHeightPx: number,
  bodyAvailPx: number,
  bodyAvailLastPx: number,
  safeCuts: number[],
  keepTogether: KeepRange[] = [],
): number[] {
  if (bodyHeightPx <= 0) return [];
  if (bodyAvailPx <= 0) return [bodyHeightPx];

  const lastAvail = Math.max(1, bodyAvailLastPx);
  const midAvail = Math.max(1, bodyAvailPx);
  const cuts = [...safeCuts].filter((c) => c > 0 && c <= bodyHeightPx).sort((a, b) => a - b);
  if (!cuts.includes(bodyHeightPx)) cuts.push(bodyHeightPx);

  // Also allow cutting at the start of keep-together blocks (move whole block to next page)
  for (const k of keepTogether) {
    if (k.start > 0 && k.start < bodyHeightPx) cuts.push(k.start);
  }
  const allCuts = Array.from(new Set(cuts)).sort((a, b) => a - b);

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

    // Prefer not to start a keep-together block unless the whole block fits on this page
    let effectiveMax = maxThisPage;
    for (const k of keepTogether) {
      if (k.start >= renderedPx && k.start < renderedPx + maxThisPage) {
        const blockH = k.end - k.start;
        // If we cannot fit the whole block on this page, cut before it starts
        if (k.end - renderedPx > maxThisPage || k.end - renderedPx > lastAvail) {
          if (k.start > renderedPx) {
            effectiveMax = Math.min(effectiveMax, k.start - renderedPx);
          }
        }
      }
    }

    let cutAt = pickSafeCut(renderedPx, Math.max(1, effectiveMax), remainingPx, allCuts);
    // Reject cuts that split a keep-together block
    if (cutSplitsKeep(cutAt, renderedPx, keepTogether)) {
      const before = keepTogether.find((k) => cutAt > k.start && cutAt < k.end);
      if (before && before.start > renderedPx) {
        cutAt = before.start;
      }
    }

    let thisSlicePx = cutAt - renderedPx;

    if (thisSlicePx <= 0) {
      thisSlicePx = Math.min(Math.max(1, effectiveMax), remainingPx - 1);
    }
    if (thisSlicePx >= remainingPx) {
      thisSlicePx = Math.max(1, Math.min(midAvail, remainingPx - 1));
    }

    slices.push(thisSlicePx);
    renderedPx += thisSlicePx;
  }

  return slices;
}
