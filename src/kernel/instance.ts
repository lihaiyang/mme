import { ExtensionRegistry, PluginHost } from './index'
import { CommandBus } from './command-bus'
import { FeatureStore } from './feature-store'
import { RenderContext } from './render-context'

export const extensions = new ExtensionRegistry()
export const renderContext = new RenderContext()
export const commandBus = new CommandBus()
export const featureStore = new FeatureStore()
export const host = new PluginHost(
  extensions,
  renderContext,
  commandBus,
  featureStore,
)
