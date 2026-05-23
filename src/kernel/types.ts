import type maplibregl from 'maplibre-gl'
import type { Command, CommandHandler } from './command-bus'
import type { FeatureCollection, FeatureId } from './feature-store'

export type PluginManifest = {
  id: string
  name: string
  version: string
  apiVersion: string
  entry: string
}

export type Disposable = {
  dispose: () => void | Promise<void>
}

export type PanelSlot = 'left' | 'right.layers' | 'right.properties'

export type PanelContribution = {
  id: string
  slot: PanelSlot
  title?: string
  render: (host: HTMLElement) => Disposable
}

export type Extensions = {
  registerPanel: (panel: PanelContribution) => Disposable
}

export type Commands = {
  register: (type: string, handler: CommandHandler) => Disposable
  dispatch: (cmd: Command) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean
  subscribe: (fn: () => void) => () => void
}

export type Features = {
  set: (id: string, fc: FeatureCollection) => void
  get: (id: string) => FeatureCollection | undefined
  has: (id: string) => boolean
  ids: () => string[]
  delete: (id: string) => boolean
  findFeature: (
    sourceId: string,
    featureId: FeatureId,
  ) => ReturnType<import('./feature-store').FeatureStore['findFeature']>
  subscribe: (fn: (id: string) => void) => () => void
}

export type PluginContext = {
  manifest: PluginManifest
  log: (msg: string) => void
  extensions: Extensions
  getMap: () => Promise<maplibregl.Map>
  commands: Commands
  features: Features
}

export type Plugin = {
  activate: (ctx: PluginContext) => Disposable | Promise<Disposable>
}
