import { useState, useSyncExternalStore } from 'react'
import { extensions } from '../kernel/instance'
import type { PanelSlot } from '../kernel'
import { PanelMount } from './PanelMount'

const TABS: { id: 'layers' | 'properties'; label: string; slot: PanelSlot }[] = [
  { id: 'layers', label: 'Layers', slot: 'right.layers' },
  { id: 'properties', label: 'Properties', slot: 'right.properties' },
]

export function RightPanel() {
  const [active, setActive] = useState<'layers' | 'properties'>('layers')

  const layers = useSyncExternalStore(
    (cb) => extensions.subscribe(cb),
    () => extensions.panelsBySlot('right.layers'),
  )
  const properties = useSyncExternalStore(
    (cb) => extensions.subscribe(cb),
    () => extensions.panelsBySlot('right.properties'),
  )

  const panels = active === 'layers' ? layers : properties

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabs__body">
        {panels.length === 0 ? (
          <div className="empty-hint">
            {active === 'properties'
              ? '选中要素以查看属性'
              : '暂无图层(加载插件以填充)'}
          </div>
        ) : (
          panels.map((p) => <PanelMount key={p.id} panel={p} />)
        )}
      </div>
    </>
  )
}
