import type { Disposable } from './types'

export type Command = {
  id?: string
  type: string
  payload: unknown
}

export type CommandHandler = {
  apply: (payload: unknown) => Disposable | Promise<Disposable>
}

type HistoryEntry = {
  cmd: Command
  undo: Disposable
}

export class CommandBus {
  private handlers = new Map<string, CommandHandler>()
  private history: HistoryEntry[] = []
  private cursor = 0
  private listeners = new Set<() => void>()
  private log: (line: string) => void

  constructor(log: (line: string) => void = (l) => console.log(l)) {
    this.log = log
  }

  register(type: string, handler: CommandHandler): Disposable {
    if (this.handlers.has(type)) {
      throw new Error(`command "${type}" already registered`)
    }
    this.handlers.set(type, handler)
    return {
      dispose: () => {
        this.handlers.delete(type)
      },
    }
  }

  async dispatch(cmd: Command): Promise<void> {
    const h = this.handlers.get(cmd.type)
    if (!h) throw new Error(`no handler for command "${cmd.type}"`)
    const undo = await h.apply(cmd.payload)
    while (this.history.length > this.cursor) this.history.pop()
    this.history.push({ cmd, undo })
    this.cursor++
    this.log(`[cmd] ${cmd.type}`)
    this.emit()
  }

  canUndo(): boolean {
    return this.cursor > 0
  }

  canRedo(): boolean {
    return this.cursor < this.history.length
  }

  async undo(): Promise<void> {
    if (!this.canUndo()) return
    this.cursor--
    const e = this.history[this.cursor]!
    await e.undo.dispose()
    this.log(`[cmd] undo ${e.cmd.type}`)
    this.emit()
  }

  async redo(): Promise<void> {
    if (!this.canRedo()) return
    const e = this.history[this.cursor]!
    const h = this.handlers.get(e.cmd.type)
    if (!h) throw new Error(`no handler for command "${e.cmd.type}"`)
    const undo = await h.apply(e.cmd.payload)
    e.undo = undo
    this.cursor++
    this.log(`[cmd] redo ${e.cmd.type}`)
    this.emit()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  size(): number {
    return this.history.length
  }

  getCursor(): number {
    return this.cursor
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}
