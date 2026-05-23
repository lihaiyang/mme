import type maplibregl from 'maplibre-gl'
import type {
  Feature,
  FeatureCollection,
  FeatureId,
  Position,
} from '../../kernel/feature-store'
import type { Plugin } from '../../kernel/types'

const SELECTED_SOURCE = 'edit.selected'
const VERTEX_SOURCE = 'edit.vertices'

type Selection = { sourceId: string; featureId: FeatureId } | null

type DragState = {
  sourceId: string
  featureId: FeatureId
  vertexIndex: number
  originalCoord: Position
} | null

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

function emptyFc(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

const plugin: Plugin = {
  async activate(ctx) {
    ctx.log('activated')
    const map = await ctx.getMap()

    let selection: Selection = null
    let dragState: DragState = null
    let breakPending = false
    let propertiesEl: HTMLElement | null = null

    // ---------------- Visualization layers ----------------

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addSource(SELECTED_SOURCE, { type: 'geojson', data: emptyFc() as any })
    map.addLayer({
      id: `${SELECTED_SOURCE}.line`,
      type: 'line',
      source: SELECTED_SOURCE,
      filter: [
        'any',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
      ],
      paint: {
        'line-color': '#fbbf24',
        'line-width': 5,
        'line-opacity': 0.85,
      },
    })
    map.addLayer({
      id: `${SELECTED_SOURCE}.point`,
      type: 'circle',
      source: SELECTED_SOURCE,
      filter: [
        'any',
        ['==', ['geometry-type'], 'Point'],
        ['==', ['geometry-type'], 'MultiPoint'],
      ],
      paint: {
        'circle-color': '#fbbf24',
        'circle-radius': 8,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addSource(VERTEX_SOURCE, { type: 'geojson', data: emptyFc() as any })
    map.addLayer({
      id: VERTEX_SOURCE,
      type: 'circle',
      source: VERTEX_SOURCE,
      paint: {
        'circle-color': '#fff',
        'circle-radius': 5,
        'circle-stroke-color': '#0284c7',
        'circle-stroke-width': 2,
      },
    })

    function setSelectionData(features: Feature[]): void {
      const src = map.getSource(SELECTED_SOURCE) as maplibregl.GeoJSONSource
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      src.setData({ type: 'FeatureCollection', features } as any)
    }
    function setVertexData(features: Feature[]): void {
      const src = map.getSource(VERTEX_SOURCE) as maplibregl.GeoJSONSource
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      src.setData({ type: 'FeatureCollection', features } as any)
    }

    function getSelectedFeature(): Feature | null {
      if (!selection) return null
      const found = ctx.features.findFeature(
        selection.sourceId,
        selection.featureId,
      )
      return found?.feature ?? null
    }

    function renderSelectionVisuals(): void {
      const f = getSelectedFeature()
      if (!f) {
        setSelectionData([])
        setVertexData([])
        return
      }
      setSelectionData([f])

      // Vertex handles only for LineString (MVP scope)
      if (f.geometry.type === 'LineString') {
        const coords = f.geometry.coordinates
        const vertices: Feature[] = coords.map((c, i) => ({
          type: 'Feature',
          id: `vertex-${i}`,
          geometry: { type: 'Point', coordinates: c },
          properties: { vertexIndex: i },
        }))
        setVertexData(vertices)
      } else {
        setVertexData([])
      }
    }

    // ---------------- Editable layer query ----------------

    function getEditableLayerIds(): string[] {
      const ids: string[] = []
      for (const sid of ctx.features.ids()) {
        for (const suffix of ['.line', '.fill', '.point']) {
          const lid = sid + suffix
          if (map.getLayer(lid)) ids.push(lid)
        }
      }
      return ids
    }

    // ---------------- Selection ----------------

    function setSelection(s: Selection): void {
      selection = s
      renderSelectionVisuals()
      renderProperties()
    }

    // ---------------- Command handlers ----------------

    type DeletePayload = { sourceId: string; featureId: FeatureId }
    type MoveNodePayload = {
      sourceId: string
      featureId: FeatureId
      vertexIndex: number
      oldCoord: Position
      newCoord: Position
    }
    type BreakPayload = {
      sourceId: string
      featureId: FeatureId
      splitVertexIndex: number
    }
    type UpdatePropPayload = {
      sourceId: string
      featureId: FeatureId
      key: string
      oldValue: unknown
      newValue: unknown
    }

    function setFeatureAt(
      sourceId: string,
      index: number,
      newFeature: Feature,
    ): void {
      const fc = ctx.features.get(sourceId)
      if (!fc) return
      const next = [...fc.features]
      next[index] = newFeature
      ctx.features.set(sourceId, { ...fc, features: next })
    }

    function replaceFeatures(sourceId: string, features: Feature[]): void {
      const fc = ctx.features.get(sourceId)
      if (!fc) return
      ctx.features.set(sourceId, { ...fc, features })
    }

    const cmdDelete = ctx.commands.register('edit.delete-feature', {
      apply(p) {
        const { sourceId, featureId } = p as DeletePayload
        const fc = ctx.features.get(sourceId)
        if (!fc) throw new Error('source not in store')
        const idx = fc.features.findIndex((f) => f.id === featureId)
        if (idx < 0) throw new Error('feature not found')
        const removed = fc.features[idx]!
        replaceFeatures(sourceId, [
          ...fc.features.slice(0, idx),
          ...fc.features.slice(idx + 1),
        ])
        return {
          dispose() {
            const cur = ctx.features.get(sourceId)
            if (!cur) return
            const next = [...cur.features]
            next.splice(idx, 0, removed)
            ctx.features.set(sourceId, { ...cur, features: next })
          },
        }
      },
    })

    const cmdMoveNode = ctx.commands.register('edit.move-node', {
      apply(p) {
        const { sourceId, featureId, vertexIndex, oldCoord, newCoord } =
          p as MoveNodePayload
        const found = ctx.features.findFeature(sourceId, featureId)
        if (!found) throw new Error('feature not found')
        if (found.feature.geometry.type !== 'LineString') {
          throw new Error('move-node only supports LineString')
        }
        const coords = [...found.feature.geometry.coordinates]
        coords[vertexIndex] = newCoord
        setFeatureAt(sourceId, found.index, {
          ...found.feature,
          geometry: { type: 'LineString', coordinates: coords },
        })
        return {
          dispose() {
            const f2 = ctx.features.findFeature(sourceId, featureId)
            if (!f2 || f2.feature.geometry.type !== 'LineString') return
            const c2 = [...f2.feature.geometry.coordinates]
            c2[vertexIndex] = oldCoord
            setFeatureAt(sourceId, f2.index, {
              ...f2.feature,
              geometry: { type: 'LineString', coordinates: c2 },
            })
          },
        }
      },
    })

    const cmdBreak = ctx.commands.register('edit.break-link', {
      apply(p) {
        const { sourceId, featureId, splitVertexIndex } = p as BreakPayload
        const found = ctx.features.findFeature(sourceId, featureId)
        if (!found) throw new Error('feature not found')
        const orig = found.feature
        if (orig.geometry.type !== 'LineString') {
          throw new Error('break-link only supports LineString')
        }
        const coords = orig.geometry.coordinates
        if (splitVertexIndex <= 0 || splitVertexIndex >= coords.length - 1) {
          throw new Error('cannot split at endpoint')
        }
        const stamp = Date.now()
        const newId1 = `${sourceId}.split.${stamp}.a`
        const newId2 = `${sourceId}.split.${stamp}.b`
        const f1: Feature = {
          type: 'Feature',
          id: newId1,
          geometry: {
            type: 'LineString',
            coordinates: coords.slice(0, splitVertexIndex + 1),
          },
          properties: { ...(orig.properties ?? {}), _splitFrom: orig.id },
        }
        const f2: Feature = {
          type: 'Feature',
          id: newId2,
          geometry: {
            type: 'LineString',
            coordinates: coords.slice(splitVertexIndex),
          },
          properties: { ...(orig.properties ?? {}), _splitFrom: orig.id },
        }
        const fc = found.fc
        const next = [
          ...fc.features.slice(0, found.index),
          f1,
          f2,
          ...fc.features.slice(found.index + 1),
        ]
        ctx.features.set(sourceId, { ...fc, features: next })
        return {
          dispose() {
            const cur = ctx.features.get(sourceId)
            if (!cur) return
            const restored = cur.features.filter(
              (f) => f.id !== newId1 && f.id !== newId2,
            )
            restored.splice(found.index, 0, orig)
            ctx.features.set(sourceId, { ...cur, features: restored })
          },
        }
      },
    })

    const cmdUpdateProp = ctx.commands.register('edit.update-property', {
      apply(p) {
        const { sourceId, featureId, key, oldValue, newValue } =
          p as UpdatePropPayload
        const found = ctx.features.findFeature(sourceId, featureId)
        if (!found) throw new Error('feature not found')
        const props = { ...(found.feature.properties ?? {}), [key]: newValue }
        setFeatureAt(sourceId, found.index, {
          ...found.feature,
          properties: props,
        })
        return {
          dispose() {
            const f2 = ctx.features.findFeature(sourceId, featureId)
            if (!f2) return
            const restored = { ...(f2.feature.properties ?? {}) }
            if (oldValue === undefined) delete restored[key]
            else restored[key] = oldValue
            setFeatureAt(sourceId, f2.index, {
              ...f2.feature,
              properties: restored,
            })
          },
        }
      },
    })

    // ---------------- Properties panel ----------------

    function renderProperties(): void {
      if (!propertiesEl) return
      // skip re-render if input focused (avoids losing focus mid-typing)
      if (propertiesEl.contains(document.activeElement)) return
      propertiesEl.innerHTML = ''
      const f = getSelectedFeature()
      if (!f) {
        const empty = document.createElement('div')
        empty.className = 'empty-hint'
        empty.textContent = '点击地图上的要素以查看/编辑属性'
        propertiesEl.appendChild(empty)
        return
      }

      const meta = document.createElement('div')
      meta.className = 'props-meta'
      meta.innerHTML = `<span>id: <code>${escapeHtml(String(f.id ?? '—'))}</code></span><span>geom: <code>${escapeHtml(f.geometry.type)}</code></span>`
      propertiesEl.appendChild(meta)

      const props = f.properties ?? {}
      const table = document.createElement('div')
      table.className = 'props'
      for (const [key, val] of Object.entries(props)) {
        const row = document.createElement('div')
        row.className = 'props-row'

        const keyEl = document.createElement('span')
        keyEl.className = 'props-key'
        keyEl.textContent = key

        const input = document.createElement('input')
        input.className = 'props-input'
        input.value = typeof val === 'string' ? val : JSON.stringify(val)
        input.addEventListener('change', () => {
          const newVal: unknown =
            typeof val === 'string' ? input.value : tryJson(input.value)
          if (newVal === val) return
          void ctx.commands.dispatch({
            type: 'edit.update-property',
            payload: {
              sourceId: selection!.sourceId,
              featureId: selection!.featureId,
              key,
              oldValue: val,
              newValue: newVal,
            },
          })
        })

        row.appendChild(keyEl)
        row.appendChild(input)
        table.appendChild(row)
      }
      propertiesEl.appendChild(table)

      const actions = document.createElement('div')
      actions.className = 'props-actions'

      const delBtn = document.createElement('button')
      delBtn.className = 'gj-btn'
      delBtn.textContent = '删除要素'
      delBtn.addEventListener('click', () => {
        if (!selection) return
        void ctx.commands.dispatch({
          type: 'edit.delete-feature',
          payload: {
            sourceId: selection.sourceId,
            featureId: selection.featureId,
          },
        })
        setSelection(null)
      })

      if (f.geometry.type === 'LineString') {
        const breakBtn = document.createElement('button')
        breakBtn.className = 'gj-btn'
        breakBtn.textContent = breakPending
          ? '取消打断'
          : '打断 (再点击线上一点)'
        breakBtn.addEventListener('click', () => {
          if (breakPending) {
            cancelBreak()
          } else {
            breakPending = true
            map.getCanvas().style.cursor = 'crosshair'
            renderProperties()
          }
        })
        actions.appendChild(breakBtn)
      }

      actions.appendChild(delBtn)
      propertiesEl.appendChild(actions)
    }

    function tryJson(s: string): unknown {
      try {
        return JSON.parse(s)
      } catch {
        return s
      }
    }

    function cancelBreak(): void {
      if (!breakPending) return
      breakPending = false
      map.getCanvas().style.cursor = ''
      renderProperties()
    }

    // ---------------- Map interaction ----------------

    function onClick(e: maplibregl.MapMouseEvent): void {
      if (dragState) return

      if (breakPending && selection) {
        const sel = ctx.features.findFeature(
          selection.sourceId,
          selection.featureId,
        )
        if (!sel || sel.feature.geometry.type !== 'LineString') {
          cancelBreak()
          return
        }
        const coords = sel.feature.geometry.coordinates
        let bestIdx = -1
        let bestDist = Infinity
        for (let i = 1; i < coords.length - 1; i++) {
          const c = coords[i]!
          const d = (c[0] - e.lngLat.lng) ** 2 + (c[1] - e.lngLat.lat) ** 2
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
        if (bestIdx < 0) {
          cancelBreak()
          return
        }
        void ctx.commands.dispatch({
          type: 'edit.break-link',
          payload: {
            sourceId: selection.sourceId,
            featureId: selection.featureId,
            splitVertexIndex: bestIdx,
          },
        })
        cancelBreak()
        setSelection(null)
        return
      }

      const layerIds = getEditableLayerIds()
      const features = layerIds.length
        ? map.queryRenderedFeatures(e.point, { layers: layerIds })
        : []
      if (features.length === 0) {
        setSelection(null)
        return
      }
      const hit = features[0]!
      if (hit.source && hit.id != null) {
        setSelection({
          sourceId: hit.source as string,
          featureId: hit.id as FeatureId,
        })
      }
    }

    function onVertexDown(
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ): void {
      const vf = e.features?.[0]
      if (!vf || !selection) return
      e.preventDefault()
      const vertexIndex = vf.properties?.vertexIndex as number
      const sel = ctx.features.findFeature(
        selection.sourceId,
        selection.featureId,
      )
      if (!sel || sel.feature.geometry.type !== 'LineString') return
      const originalCoord = sel.feature.geometry.coordinates[
        vertexIndex
      ] as Position
      dragState = {
        sourceId: selection.sourceId,
        featureId: selection.featureId,
        vertexIndex,
        originalCoord,
      }
      map.getCanvas().style.cursor = 'grabbing'
    }

    function onMouseMove(e: maplibregl.MapMouseEvent): void {
      if (!dragState) return
      const newCoord: Position = [e.lngLat.lng, e.lngLat.lat]
      const found = ctx.features.findFeature(
        dragState.sourceId,
        dragState.featureId,
      )
      if (!found || found.feature.geometry.type !== 'LineString') return
      const coords = [...found.feature.geometry.coordinates]
      coords[dragState.vertexIndex] = newCoord
      setFeatureAt(dragState.sourceId, found.index, {
        ...found.feature,
        geometry: { type: 'LineString', coordinates: coords },
      })
    }

    function onMouseUp(e: maplibregl.MapMouseEvent): void {
      if (!dragState) return
      const ds = dragState
      dragState = null
      map.getCanvas().style.cursor = ''
      const newCoord: Position = [e.lngLat.lng, e.lngLat.lat]
      if (
        newCoord[0] === ds.originalCoord[0] &&
        newCoord[1] === ds.originalCoord[1]
      )
        return

      // History records the final delta. Apply is idempotent (current state == newCoord),
      // undo reverts to originalCoord.
      void ctx.commands.dispatch({
        type: 'edit.move-node',
        payload: {
          sourceId: ds.sourceId,
          featureId: ds.featureId,
          vertexIndex: ds.vertexIndex,
          oldCoord: ds.originalCoord,
          newCoord,
        },
      })
    }

    function onCanvasMouseUp(): void {
      if (!dragState) return
      // mouse released outside map: commit at last known position
      const ds = dragState
      dragState = null
      map.getCanvas().style.cursor = ''
      const found = ctx.features.findFeature(ds.sourceId, ds.featureId)
      if (!found || found.feature.geometry.type !== 'LineString') return
      const cur = found.feature.geometry.coordinates[ds.vertexIndex] as Position
      if (cur[0] === ds.originalCoord[0] && cur[1] === ds.originalCoord[1])
        return
      void ctx.commands.dispatch({
        type: 'edit.move-node',
        payload: {
          sourceId: ds.sourceId,
          featureId: ds.featureId,
          vertexIndex: ds.vertexIndex,
          oldCoord: ds.originalCoord,
          newCoord: cur,
        },
      })
    }

    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (inInput) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        void ctx.commands.dispatch({
          type: 'edit.delete-feature',
          payload: {
            sourceId: selection.sourceId,
            featureId: selection.featureId,
          },
        })
        setSelection(null)
        return
      }
      if (e.key === 'Escape') {
        if (breakPending) cancelBreak()
        else setSelection(null)
        return
      }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        void ctx.commands.undo()
      } else if (
        (ctrl && e.key.toLowerCase() === 'y') ||
        (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault()
        void ctx.commands.redo()
      }
    }

    function onVertexEnter(): void {
      if (!dragState) map.getCanvas().style.cursor = 'grab'
    }
    function onVertexLeave(): void {
      if (!dragState && !breakPending) map.getCanvas().style.cursor = ''
    }

    map.on('click', onClick)
    map.on('mousedown', VERTEX_SOURCE, onVertexDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('mouseenter', VERTEX_SOURCE, onVertexEnter)
    map.on('mouseleave', VERTEX_SOURCE, onVertexLeave)
    document.addEventListener('mouseup', onCanvasMouseUp)
    document.addEventListener('keydown', onKeyDown)

    // ---------------- Store subscription ----------------

    const storeSub = ctx.features.subscribe((changedSourceId) => {
      if (!selection || selection.sourceId !== changedSourceId) {
        // If our selected source disappeared, clear selection
        if (selection && !ctx.features.has(selection.sourceId)) {
          setSelection(null)
        }
        return
      }
      // Selected feature may have been deleted (e.g., from break)
      if (!getSelectedFeature()) {
        setSelection(null)
        return
      }
      renderSelectionVisuals()
      renderProperties()
    })

    // ---------------- Panel contribution ----------------

    const panel = ctx.extensions.registerPanel({
      id: `${ctx.manifest.id}.properties`,
      slot: 'right.properties',
      title: '要素属性',
      render(host) {
        propertiesEl = host
        renderProperties()
        return {
          dispose() {
            propertiesEl = null
          },
        }
      },
    })

    return {
      dispose() {
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('mouseup', onCanvasMouseUp)
        map.off('click', onClick)
        map.off('mousedown', VERTEX_SOURCE, onVertexDown)
        map.off('mousemove', onMouseMove)
        map.off('mouseup', onMouseUp)
        map.off('mouseenter', VERTEX_SOURCE, onVertexEnter)
        map.off('mouseleave', VERTEX_SOURCE, onVertexLeave)
        storeSub()
        for (const suffix of ['.line', '.point']) {
          const lid = SELECTED_SOURCE + suffix
          if (map.getLayer(lid)) map.removeLayer(lid)
        }
        if (map.getSource(SELECTED_SOURCE)) map.removeSource(SELECTED_SOURCE)
        if (map.getLayer(VERTEX_SOURCE)) map.removeLayer(VERTEX_SOURCE)
        if (map.getSource(VERTEX_SOURCE)) map.removeSource(VERTEX_SOURCE)
        cmdDelete.dispose()
        cmdMoveNode.dispose()
        cmdBreak.dispose()
        cmdUpdateProp.dispose()
        panel.dispose()
        ctx.log('disposed')
      },
    }
  },
}

export default plugin
