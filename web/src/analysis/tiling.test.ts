import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_FACE_RATIO,
  boxFromTilePoints,
  DEFAULT_TILING,
  finerPassUseful,
  gridTiles,
  interiorEdgeMargin,
  iou,
  isSameFace,
  keepSubjectFaces,
  mergeDetections,
  MIN_FACE_FRACTION,
  MIN_TILE_EDGE_MARGIN,
  overlapOfSmaller,
  planTiles,
  RELIABLE_FACE_FRACTION,
  tileSide,
  type Box,
  type Tile,
} from './tiling';

/** Overlap of consecutive tile offsets along one axis (tiles of a grid are sorted row by row). */
function axisOverlaps(tiles: Tile[], axis: 'x' | 'y'): number[] {
  const size = axis === 'x' ? 'width' : 'height';
  const starts = [...new Set(tiles.map((tile) => tile[axis]))].sort((a, b) => a - b);
  return starts.slice(1).map((start, i) => starts[i] + tiles[0][size] - start);
}

describe('gridTiles', () => {
  it('covers the image with evenly spaced tiles that overlap by at least the minimum', () => {
    for (const [width, height, tile, overlap] of [
      [1000, 600, 400, 100],
      [2048, 1536, 553, 213],
      [1536, 2048, 1229, 354],
      [777, 333, 101, 37],
    ]) {
      const tiles = gridTiles(width, height, tile, overlap);
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(width);
        expect(t.y + t.height).toBeLessThanOrEqual(height);
      }
      expect(Math.max(...tiles.map((t) => t.x + t.width))).toBe(width);
      expect(Math.max(...tiles.map((t) => t.y + t.height))).toBe(height);
      for (const value of [...axisOverlaps(tiles, 'x'), ...axisOverlaps(tiles, 'y')]) {
        expect(value).toBeGreaterThanOrEqual(overlap);
      }
    }
  });

  it('uses the whole image when the tile is not smaller', () => {
    expect(gridTiles(500, 300, 800, 50)).toEqual([{ x: 0, y: 0, width: 500, height: 300 }]);
  });
});

describe('planTiles', () => {
  it('runs the whole image, 2×2 and 6×4 tiles on a 4:3 or 3:2 face image, in either orientation', () => {
    for (const [width, height] of [
      [2048, 1536],
      [1536, 2048],
      [2048, 1365],
    ]) {
      expect(planTiles(width, height).map((pass) => pass.length)).toEqual([1, 4, 24]);
    }
  });

  it('skips passes that would not use smaller tiles', () => {
    const plan = planTiles(2048, 1536, { tileFractions: [1.2, 0.6, 0.6] });
    expect(plan.map((pass) => pass.length)).toEqual([1, 4]);
    expect(planTiles(2048, 1536, { tileFractions: [] })).toEqual([[{ x: 0, y: 0, width: 2048, height: 1536 }]]);
  });

  it('puts every face the previous pass may have missed wholly inside a tile, away from its interior edges', () => {
    const misses: string[] = [];
    for (const [width, height] of [
      [2048, 1536],
      [1536, 2048],
      [2048, 1152],
      [1000, 1000],
    ]) {
      const plan = planTiles(width, height, DEFAULT_TILING);
      for (let pass = 1; pass < plan.length; pass++) {
        // The largest face the previous pass may miss (landmark boxes are up to 1.2× taller than wide).
        const faceWidth = 0.99 * RELIABLE_FACE_FRACTION * tileSide(plan[pass - 1][0]);
        const faceHeight = 1.2 * faceWidth;
        for (let y = 0; y + faceHeight <= height; y += 23) {
          for (let x = 0; x + faceWidth <= width; x += 23) {
            const face = { x, y, width: faceWidth, height: faceHeight };
            const found = plan[pass].some(
              (tile) =>
                face.x >= tile.x &&
                face.y >= tile.y &&
                face.x + face.width <= tile.x + tile.width &&
                face.y + face.height <= tile.y + tile.height &&
                interiorEdgeMargin(face, tile, width, height) >= MIN_TILE_EDGE_MARGIN,
            );
            if (!found) misses.push(`${width}×${height} pass ${pass} face at ${x},${y}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('finerPassUseful', () => {
  it('skips finer passes once a face is known that dwarfs anything they could still find', () => {
    const plan = planTiles(2048, 1536);
    expect(finerPassUseful(tileSide(plan[0][0]), 0)).toBe(true);
    // A portrait: the face is 30% of the long edge.
    const portraitFace = 0.3 * 2048;
    expect(finerPassUseful(tileSide(plan[0][0]), portraitFace)).toBe(true);
    expect(finerPassUseful(tileSide(plan[1][0]), portraitFace)).toBe(false);
    // A group photo whose largest face is 8% of the long edge still needs the finest pass.
    expect(finerPassUseful(tileSide(plan[1][0]), 0.08 * 2048)).toBe(true);
  });
});

describe('boxFromTilePoints', () => {
  it('maps normalized tile coordinates to image pixels', () => {
    const tile = { x: 100, y: 50, width: 200, height: 100 };
    const points = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.9 },
      { x: 0.5, y: 0.2 },
    ];
    const box = boxFromTilePoints(points, tile);
    expect(box.x).toBeCloseTo(150);
    expect(box.y).toBeCloseTo(70);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(70);
    expect(boxFromTilePoints([], tile)).toEqual({ x: 100, y: 50, width: 0, height: 0 });
  });
});

describe('interiorEdgeMargin', () => {
  const image = { width: 1000, height: 1000 };
  const tile = { x: 500, y: 0, width: 500, height: 500 }; // interior edges: left and bottom

  it('is unlimited for the whole image', () => {
    expect(interiorEdgeMargin({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, ...image }, image.width, image.height)).toBe(
      Infinity,
    );
  });

  it('measures the distance to interior edges only, in face sizes', () => {
    expect(interiorEdgeMargin({ x: 520, y: 0, width: 100, height: 100 }, tile, image.width, image.height)).toBeCloseTo(0.2);
    expect(interiorEdgeMargin({ x: 900, y: 0, width: 100, height: 100 }, tile, image.width, image.height)).toBeCloseTo(4);
  });

  it('flags faces cut by an interior edge', () => {
    expect(interiorEdgeMargin({ x: 500, y: 200, width: 100, height: 100 }, tile, image.width, image.height)).toBeLessThan(
      MIN_TILE_EDGE_MARGIN,
    );
    expect(interiorEdgeMargin({ x: 700, y: 430, width: 100, height: 70 }, tile, image.width, image.height)).toBeLessThan(
      MIN_TILE_EDGE_MARGIN,
    );
  });
});

describe('box overlap', () => {
  const a: Box = { x: 0, y: 0, width: 10, height: 10 };

  it('iou and overlapOfSmaller', () => {
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { x: 20, y: 0, width: 10, height: 10 })).toBe(0);
    expect(iou(a, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(1 / 3);
    const inner = { x: 2, y: 2, width: 4, height: 4 };
    expect(overlapOfSmaller(a, inner)).toBe(1);
    expect(iou(a, inner)).toBeCloseTo(0.16);
  });

  it('isSameFace merges a partial detection with the full face but keeps neighbours apart', () => {
    const face = { x: 100, y: 100, width: 100, height: 120 };
    expect(isSameFace(face, { x: 100, y: 100, width: 60, height: 120 })).toBe(true);
    expect(isSameFace(face, { x: 104, y: 98, width: 98, height: 118 })).toBe(true);
    expect(isSameFace(face, { x: 180, y: 100, width: 100, height: 120 })).toBe(false);
  });
});

describe('mergeDetections', () => {
  const face = (id: string, x: number, width: number, margin: number) => ({ id, box: { x, y: 0, width, height: width }, margin });

  it('keeps the copy farthest from a tile edge, then the larger one, in input order', () => {
    const merged = mergeDetections([
      face('a-tile', 0, 104, 0.3),
      face('b-coarse', 500, 100, 0.6),
      face('a-whole', 2, 100, Infinity),
      face('b-fine', 498, 104, 2),
      face('c', 1000, 50, 0.2),
    ]);
    expect(merged.map(({ id }) => id)).toEqual(['a-whole', 'b-fine', 'c']);
  });
});

describe('keepSubjectFaces', () => {
  const face = (width: number) => ({ box: { x: 0, y: 0, width, height: width } });

  it('drops implausibly tiny faces and background bystanders', () => {
    const minWidth = MIN_FACE_FRACTION * 2000;
    const kept = keepSubjectFaces([face(300), face(100), face(BACKGROUND_FACE_RATIO * 300 - 1), face(minWidth - 1)], 2000, 1000);
    expect(kept.map(({ box }) => box.width)).toEqual([300, 100]);
  });

  it('keeps every face of an evenly sized group', () => {
    const group = [60, 64, 70, 66, 58, 75].map(face);
    expect(keepSubjectFaces(group, 2048, 1365)).toHaveLength(6);
    expect(keepSubjectFaces([face(10)], 2048, 1365)).toEqual([]);
  });
});
