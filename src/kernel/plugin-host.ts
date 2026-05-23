import type {
  Commands,
  Disposable,
  Extensions,
  Features,
  Plugin,
  PluginContext,
  PluginManifest,
} from './types'
import { CommandBus } from './command-bus'
import { ExtensionRegistry } from './extension-registry'
import { FeatureStore } from './feature-store'
import { RenderContext } from './render-context'

export type Importer = () => Promise<{ default: Plugin }>

type LoadedPlugin = {
  manifest: PluginManifest
  userDisposable: Disposable
  contributions: Disposable[]
}

export class PluginHost {
  private loaded = new Map<string, LoadedPlugin>()
  private listeners = new Set<() => void>()
  private snapshot: string[] | null = null
  private log: (line: string) => void

  constructor(
    public readonly extensions: ExtensionRegistry,
    public readonly renderContext: RenderContext,
    public readonly commandBus: CommandBus,
    public readonly featureStore: FeatureStore,
    log: (line: string) => void = (l) => console.log(l),
  ) {
    this.log = log
  }

  list(): PluginManifest[] {
    return [...this.loaded.values()].map((p) => p.manifest)
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }

  getLoadedIds(): string[] {
    if (!this.snapshot) this.snapshot = [...this.loaded.keys()].sort()
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  async load(manifest: PluginManifest, importer: Importer): Promise<void> {
    if (this.loaded.has(manifest.id)) {
      throw new Error(`plugin "${manifest.id}" already loaded`)
    }

    const mod = await importer()
    const plugin = mod.default
    if (!plugin || typeof plugin.activate !== 'function') {
      throw new Error(
        `plugin "${manifest.id}" does not export a default { activate }`,
      )
    }

    const contributions: Disposable[] = []
    const extensions: Extensions = {
      registerPanel: (panel) => {
        const d = this.extensions.registerPanel(panel)
        contributions.push(d)
        return d
      },
    }

    const commands: Commands = {
      register: (type, handler) => {
        const d = this.commandBus.register(type, handler)
        contributions.push(d)
        return d
      },
      dispatch: (cmd) => this.commandBus.dispatch(cmd),
      undo: () => this.commandBus.undo(),
      redo: () => this.commandBus.redo(),
      canUndo: () => this.commandBus.canUndo(),
      canRedo: () => this.commandBus.canRedo(),
      subscribe: (fn) => this.commandBus.subscribe(fn),
    }

    const features: Features = {
      set: (id, fc) => this.featureStore.set(id, fc),
      get: (id) => this.featureStore.get(id),
      has: (id) => this.featureStore.has(id),
      ids: () => this.featureStore.ids(),
      delete: (id) => this.featureStore.delete(id),
      findFeature: (sourceId, featureId) =>
        this.featureStore.findFeature(sourceId, featureId),
      subscribe: (fn) => this.featureStore.subscribe(fn),
    }

    const ctx: PluginContext = {
      manifest,
      log: (msg) => this.log(`[${manifest.id}] ${msg}`),
      extensions,
      getMap: () => this.renderContext.getMap(),
      commands,
      features,
    }

    const userDisposable = await plugin.activate(ctx)
    this.loaded.set(manifest.id, { manifest, userDisposable, contributions })
    this.log(`[host] loaded "${manifest.id}@${manifest.version}"`)
    this.emit()
  }

  async unload(id: string): Promise<void> {
    const entry = this.loaded.get(id)
    if (!entry) throw new Error(`plugin "${id}" not loaded`)
    try {
      await entry.userDisposable.dispose()
    } finally {
      for (const c of entry.contributions) {
        try {
          await c.dispose()
        } catch (e) {
          console.error(e)
        }
      }
      this.loaded.delete(id)
      this.log(`[host] unloaded "${id}"`)
      this.emit()
    }
  }

  private emit() {
    this.snapshot = null
    for (const fn of this.listeners) fn()
  }
}
