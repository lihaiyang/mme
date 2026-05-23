import { useState, useSyncExternalStore } from 'react'
import { commandBus, host } from '../kernel/instance'
import helloManifest from '../plugins/hello-world/manifest.json'
import type { PanelMode } from './Layout'

const MODES: { value: PanelMode; label: string }[] = [
  { value: 'pinned', label: 'Pin' },
  { value: 'peek', label: 'Peek' },
  { value: 'hidden', label: 'Hide' },
]

function ModeGroup({
  label,
  value,
  onChange,
}: {
  label: string
  value: PanelMode
  onChange: (m: PanelMode) => void
}) {
  return (
    <div className="panel-mode">
      <span>{label}:</span>
      <div className="panel-mode__group">
        {MODES.map((m) => (
          <button
            key={m.value}
            aria-pressed={value === m.value}
            onClick={() => onChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function useCommandState() {
  return useSyncExternalStore(
    (cb) => commandBus.subscribe(cb),
    () => `${commandBus.canUndo() ? '1' : '0'}|${commandBus.canRedo() ? '1' : '0'}|${commandBus.size()}|${commandBus.getCursor()}`,
  )
}

export function Header({
  leftMode,
  rightMode,
  onLeftMode,
  onRightMode,
}: {
  leftMode: PanelMode
  rightMode: PanelMode
  onLeftMode: (m: PanelMode) => void
  onRightMode: (m: PanelMode) => void
}) {
  const ids = useSyncExternalStore(
    (cb) => host.subscribe(cb),
    () => host.getLoadedIds(),
  )
  useCommandState()
  const canUndo = commandBus.canUndo()
  const canRedo = commandBus.canRedo()

  const [error, setError] = useState<string | null>(null)
  const helloLoaded = ids.includes(helloManifest.id)

  async function toggleHello() {
    setError(null)
    try {
      if (helloLoaded) {
        await host.unload(helloManifest.id)
      } else {
        await host.load(
          helloManifest,
          () => import('../plugins/hello-world/index.ts'),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="header">
      <div className="header__title">MME</div>
      <div className="header__actions">
        <div className="undo-redo">
          <button
            onClick={() => void commandBus.undo()}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            onClick={() => void commandBus.redo()}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
          >
            ↷ Redo
          </button>
        </div>
        <span className="header__sep" />
        <ModeGroup label="Left" value={leftMode} onChange={onLeftMode} />
        <ModeGroup label="Right" value={rightMode} onChange={onRightMode} />
        <span className="header__sep" />
        {error && <span className="header__error">{error}</span>}
        <span className="header__loaded">[{ids.join(', ') || 'none'}]</span>
        <button onClick={toggleHello}>
          {helloLoaded ? 'Unload' : 'Load'} hello-world
        </button>
      </div>
    </div>
  )
}
