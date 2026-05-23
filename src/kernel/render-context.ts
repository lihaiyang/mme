import type maplibregl from 'maplibre-gl'

export class RenderContext {
  private map: maplibregl.Map | null = null
  private waiters: Array<(m: maplibregl.Map) => void> = []

  setMap(map: maplibregl.Map | null): void {
    this.map = map
    if (map) {
      const w = this.waiters
      this.waiters = []
      for (const fn of w) fn(map)
    }
  }

  getMap(): Promise<maplibregl.Map> {
    if (this.map) return Promise.resolve(this.map)
    return new Promise<maplibregl.Map>((res) => {
      this.waiters.push(res)
    })
  }
}
