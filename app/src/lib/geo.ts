type Ring = number[][];

function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, rings: Ring[]) {
  if (!inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
  return true;
}

export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  return g.type === 'Polygon'
    ? inPolygon(lon, lat, g.coordinates)
    : g.coordinates.some((poly) => inPolygon(lon, lat, poly));
}

export type BBox = [number, number, number, number];

export function extendBBox(b: BBox | null, lon: number, lat: number): BBox {
  if (!b) return [lon, lat, lon, lat];
  return [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)];
}

export function geometryBBox(g: GeoJSON.Polygon | GeoJSON.MultiPolygon, into: BBox | null = null): BBox | null {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let b = into;
  for (const poly of polys) for (const [lon, lat] of poly[0]) b = extendBBox(b, lon, lat);
  return b;
}
