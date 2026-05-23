import { useEffect, useRef } from 'react'
import type { PanelContribution } from '../kernel'

export function PanelMount({ panel }: { panel: PanelContribution }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const d = panel.render(hostRef.current)
    return () => {
      void d.dispose()
    }
  }, [panel])

  return (
    <div className="panel-section">
      {panel.title && (
        <div className="panel-section__title">{panel.title}</div>
      )}
      <div className="panel-section__body" ref={hostRef} />
    </div>
  )
}
