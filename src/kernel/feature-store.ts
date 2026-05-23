export type Position = [number, number] | [number, number, number]

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

export type FeatureId = string | number

export type Feature = {
  type: 'Feature'
  id?: FeatureId
  geometry: Geometry
  properties: Record<string, unknown> | null
}

export type FeatureCollection = {
  type: 'FeatureCollection'
  features: Feature[]
  bbox?: number[]
  [k: string]: unknown
}

export class FeatureStore {
  private collections = new Map<string, FeatureCollection>()
  private listeners = new Set<(id: string) => void>()

  set(id: string, fc: FeatureCollection): void {
    this.collections.set(id, fc)
    this.emit(id)
  }

  get(id: string): FeatureCollection | undefined {
    return this.collections.get(id)
  }

  has(id: string): boolean {
    return this.collections.has(id)
  }

  ids(): string[] {
    return [...this.collections.keys()]
  }

  delete(id: string): boolean {
    const ok = this.collections.delete(id)
    if (ok) this.emit(id)
    return ok
  }

  findFeature(
    sourceId: string,
    featureId: FeatureId,
  ): { fc: FeatureCollection; index: number; feature: Feature } | null {
    const fc = this.collections.get(sourceId)
    if (!fc) return null
    const index = fc.features.findIndex((f) => f.id === featureId)
    if (index < 0) return null
    return { fc, index, feature: fc.features[index]! }
  }

  subscribe(fn: (id: string) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(id: string): void {
    for (const fn of this.listeners) fn(id)
  }
}
