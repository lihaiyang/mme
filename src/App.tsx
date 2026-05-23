import { useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { Layout, type PanelMode } from './components/Layout'
import { LeftPanel } from './components/LeftPanel'
import { MapView } from './components/MapView'
import { RightPanel } from './components/RightPanel'
import { host } from './kernel/instance'
import editManifest from './plugins/edit/manifest.json'
import geojsonManifest from './plugins/geojson-loader/manifest.json'

export function App() {
  const [leftMode, setLeftMode] = useState<PanelMode>('pinned')
  const [rightMode, setRightMode] = useState<PanelMode>('pinned')

  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void (async () => {
      try {
        await host.load(
          geojsonManifest,
          () => import('./plugins/geojson-loader/index.ts'),
        )
        await host.load(
          editManifest,
          () => import('./plugins/edit/index.ts'),
        )
      } catch (e) {
        console.error('plugin auto-load failed:', e)
      }
    })()
  }, [])

  return (
    <Layout
      header={
        <Header
          leftMode={leftMode}
          rightMode={rightMode}
          onLeftMode={setLeftMode}
          onRightMode={setRightMode}
        />
      }
      left={<LeftPanel />}
      center={<MapView />}
      right={<RightPanel />}
      leftMode={leftMode}
      rightMode={rightMode}
    />
  )
}
