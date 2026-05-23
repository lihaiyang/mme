import type { Plugin } from '../../kernel/types'

const plugin: Plugin = {
  activate(ctx) {
    ctx.log('activated')

    const panel = ctx.extensions.registerPanel({
      id: `${ctx.manifest.id}.demo`,
      slot: 'right.layers',
      title: ctx.manifest.name,
      render(host) {
        const el = document.createElement('div')
        el.textContent = `Hello from ${ctx.manifest.id} v${ctx.manifest.version}`
        host.appendChild(el)
        return {
          dispose() {
            el.remove()
          },
        }
      },
    })

    return {
      dispose() {
        panel.dispose()
        ctx.log('disposed')
      },
    }
  },
}

export default plugin
