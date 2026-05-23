import type { ReactNode } from 'react'

export type PanelMode = 'pinned' | 'peek' | 'hidden'

export function Layout({
  header,
  left,
  center,
  right,
  leftMode,
  rightMode,
}: {
  header: ReactNode
  left: ReactNode
  center: ReactNode
  right: ReactNode
  leftMode: PanelMode
  rightMode: PanelMode
}) {
  const leftCol = leftMode === 'pinned' ? '280px' : '0'
  const rightCol = rightMode === 'pinned' ? '320px' : '0'

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${leftCol} 1fr ${rightCol}` }}
    >
      <div className="app__header">{header}</div>
      <div className="app__center">{center}</div>

      {leftMode === 'pinned' && <aside className="app__left">{left}</aside>}
      {leftMode === 'peek' && (
        <div className="peek-zone peek-zone--left">
          <aside className="peek-panel peek-panel--left">{left}</aside>
        </div>
      )}

      {rightMode === 'pinned' && <aside className="app__right">{right}</aside>}
      {rightMode === 'peek' && (
        <div className="peek-zone peek-zone--right">
          <aside className="peek-panel peek-panel--right">{right}</aside>
        </div>
      )}
    </div>
  )
}
