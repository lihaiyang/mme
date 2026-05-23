import type { Disposable, PanelContribution, PanelSlot } from './types'

const EMPTY: PanelContribution[] = []

export class ExtensionRegistry {
  private panels = new Map<string, PanelContribution>()
  private bySlot = new Map<PanelSlot, PanelContribution[]>()
  private listeners = new Set<() => void>()

  registerPanel(panel: PanelContribution): Disposable {
    if (this.panels.has(panel.id)) {
      throw new Error(`panel id "${panel.id}" already registered`)
    }
    this.panels.set(panel.id, panel)
    this.rebuild(panel.slot)
    this.emit()
    return {
      dispose: () => {
        if (this.panels.delete(panel.id)) {
          this.rebuild(panel.slot)
          this.emit()
        }
      },
    }
  }

  panelsBySlot(slot: PanelSlot): PanelContribution[] {
    return this.bySlot.get(slot) ?? EMPTY
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private rebuild(slot: PanelSlot) {
    const list = [...this.panels.values()].filter((p) => p.slot === slot)
    this.bySlot.set(slot, list)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}
