import type maplibregl from 'maplibre-gl'
import type { Plugin } from '../../kernel/types'
import type { Feature, FeatureCollection } from '../../kernel/feature-store'

type LoadedLayer = {
  id: string
  name: string
  count: number
  color: string
}

const LAYER_COLORS = ['#ef4444', '#0284c7', '#16a34a', '#a855f7', '#f59e0b']

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  )
}

function computeBounds(
  fc: FeatureCollection,
): [[number, number], [number, number]] | null {
  if (Array.isArray(fc.bbox) && fc.bbox.length >= 4) {
    return [
      [fc.bbox[0]!, fc.bbox[1]!],
      [fc.bbox[2]!, fc.bbox[3]!],
    ]
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const x = coords[0] as number
      const y = coords[1] as number
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return
    }
    for (const c of coords) walk(c)
  }
  for (const f of fc.features) walk(f.geometry?.coordinates)
  if (!isFinite(minX)) return null
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

function normalize(data: unknown, sourceId: string): FeatureCollection {
  if (!data || typeof data !== 'object') {
    throw new Error('not a GeoJSON object')
  }
  const d = data as Record<string, unknown>
  let features: Feature[]
  if (d.type === 'FeatureCollection') {
    features = (d.features as Feature[]) ?? []
  } else if (d.type === 'Feature') {
    features = [d as unknown as Feature]
  } else {
    throw new Error('not a GeoJSON FeatureCollection or Feature')
  }
  return {
    type: 'FeatureCollection',
    features: features.map((f, i) =>
      f.id != null ? f : { ...f, id: `${sourceId}.f${i}` },
    ),
    bbox: Array.isArray(d.bbox) ? (d.bbox as number[]) : undefined,
  }
}

const plugin: Plugin = {
  async activate(ctx) {
    ctx.log('activated')
    const map = await ctx.getMap()

    let counter = 0
    const layers: LoadedLayer[] = []
    const ownedSources = new Set<string>()
    let listEl: HTMLElement | null = null
    let statusEl: HTMLElement | null = null

    function setStatus(text: string, isError = false): void {
      if (!statusEl) return
      statusEl.textContent = text
      statusEl.style.color = isError ? '#b91c1c' : '#16a34a'
    }

    function renderList(): void {
      if (!listEl) return
      listEl.innerHTML = ''
      if (layers.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'gj-empty'
        empty.textContent = '尚未加载任何 GeoJSON'
        listEl.appendChild(empty)
        return
      }
      for (const l of layers) {
        const row = document.createElement('div')
        row.className = 'gj-row'
        row.innerHTML = `<span class="gj-swatch" style="background:${l.color}"></span><span class="gj-row__name" title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</span><span class="gj-row__count">${l.count}</span><button class="gj-row__remove" aria-label="remove">×</button>`
        row
          .querySelector('.gj-row__remove')!
          .addEventListener('click', () => ctx.features.delete(l.id))
        listEl.appendChild(row)
      }
    }

    function removeMapArtifacts(sourceId: string): void {
      for (const suffix of ['.line', '.fill', '.point']) {
        const lid = sourceId + suffix
        if (map.getLayer(lid)) map.removeLayer(lid)
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }

    const featureSub = ctx.features.subscribe((sourceId) => {
      if (!ownedSources.has(sourceId)) return
      const fc = ctx.features.get(sourceId)
      if (!fc) {
        removeMapArtifacts(sourceId)
        ownedSources.delete(sourceId)
        const idx = layers.findIndex((l) => l.id === sourceId)
        if (idx >= 0) layers.splice(idx, 1)
        renderList()
        return
      }
      const src = map.getSource(sourceId) as
        | maplibregl.GeoJSONSource
        | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (src) src.setData(fc as any)
      const layer = layers.find((l) => l.id === sourceId)
      if (layer && layer.count !== fc.features.length) {
        layer.count = fc.features.length
        renderList()
      }
    })

    async function addGeoJSON(name: string, raw: unknown): Promise<void> {
      counter += 1
      const sourceId = `${ctx.manifest.id}.${counter}`
      const color =
        LAYER_COLORS[(counter - 1) % LAYER_COLORS.length] ?? LAYER_COLORS[0]!

      const fc = normalize(raw, sourceId)

      map.addSource(sourceId, {
        type: 'geojson',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { type: 'FeatureCollection', features: [] } as any,
      })
      map.addLayer({
        id: `${sourceId}.line`,
        type: 'line',
        source: sourceId,
        filter: [
          'any',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['geometry-type'], 'MultiLineString'],
        ],
        paint: { 'line-color': color, 'line-width': 2 },
      })
      map.addLayer({
        id: `${sourceId}.fill`,
        type: 'fill',
        source: sourceId,
        filter: [
          'any',
          ['==', ['geometry-type'], 'Polygon'],
          ['==', ['geometry-type'], 'MultiPolygon'],
        ],
        paint: { 'fill-color': color, 'fill-opacity': 0.3 },
      })
      map.addLayer({
        id: `${sourceId}.point`,
        type: 'circle',
        source: sourceId,
        filter: [
          'any',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['geometry-type'], 'MultiPoint'],
        ],
        paint: { 'circle-color': color, 'circle-radius': 4 },
      })

      ownedSources.add(sourceId)
      layers.push({ id: sourceId, name, count: fc.features.length, color })
      renderList()

      ctx.features.set(sourceId, fc)

      const bounds = computeBounds(fc)
      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 600 })

      setStatus(`已加载 "${name}" (${fc.features.length} 要素)`)
    }

    const panel = ctx.extensions.registerPanel({
      id: `${ctx.manifest.id}.main`,
      slot: 'right.layers',
      title: ctx.manifest.name,
      render(host) {
        host.innerHTML = `
          <div class="gj-actions">
            <button class="gj-btn" data-action="sample">加载样例路网</button>
            <button class="gj-btn" data-action="file">从文件加载…</button>
            <input type="file" class="gj-file-input" accept=".geojson,.json,application/geo+json,application/json" style="display:none" />
          </div>
          <div class="gj-status"></div>
          <div class="gj-list"></div>
        `
        listEl = host.querySelector('.gj-list')
        statusEl = host.querySelector('.gj-status')
        const fileInput = host.querySelector(
          '.gj-file-input',
        ) as HTMLInputElement

        host
          .querySelector('[data-action="sample"]')!
          .addEventListener('click', async () => {
            try {
              const res = await fetch('/sample-roads.geojson')
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const data = await res.json()
              await addGeoJSON('Sample roads (Shanghai)', data)
            } catch (e) {
              setStatus(e instanceof Error ? e.message : String(e), true)
            }
          })

        host
          .querySelector('[data-action="file"]')!
          .addEventListener('click', () => fileInput.click())

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0]
          if (!file) return
          try {
            const text = await file.text()
            const data = JSON.parse(text)
            await addGeoJSON(file.name, data)
          } catch (e) {
            setStatus(e instanceof Error ? e.message : String(e), true)
          } finally {
            fileInput.value = ''
          }
        })

        renderList()
        return {
          dispose() {
            listEl = null
            statusEl = null
          },
        }
      },
    })

    return {
      dispose() {
        featureSub()
        for (const sourceId of [...ownedSources]) {
          ctx.features.delete(sourceId)
        }
        panel.dispose()
        ctx.log('disposed')
      },
    }
  },
}

export default plugin
