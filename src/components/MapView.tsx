import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { renderContext } from '../kernel/instance'

export function MapView() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [121.475, 31.235],
      zoom: 13,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    renderContext.setMap(map)
    return () => {
      renderContext.setMap(null)
      map.remove()
    }
  }, [])

  return <div ref={ref} className="map-root" />
}
