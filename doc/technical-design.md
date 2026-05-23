# MME 技术设计文档

> 本文档是 MME(Map Editor)项目当前生效的技术设计基线。  
> 决策来源与权衡过程见 [`discussion-log.md`](./discussion-log.md)。
>
> 文档结构稳定,实现过程中如有架构调整,直接修订本文件并在 discussion log 末尾追加 Round。

---

## 1. 产品定位

MME 是一个**可独立运行的 Web 地图编辑器**,具备完整的地图渲染、矢量编辑、图片标注能力。

核心架构主张:
- **前端是通用的地图操作客户端**,不绑定特定业务领域
- 通过**指令协议**与不同业务后端解耦(编辑 / 标注 / 评测 / ...)
- 整体**插件化**,核心 (kernel) 极度精简,业务能力以插件形态接入和迭代
- 支持**离线编辑**(本地 GeoJSON 文件)与**联机编辑**(后端联动)双模式

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                          UI Shell                            │
│   ┌──────────┬─────────────────────────────┬─────────────┐   │
│   │  Left    │         Center              │   Right     │   │
│   │ (tasks   │   (Map / Annotation         │  (Layers /  │   │
│   │  & misc) │    mode-switchable)         │  Properties │   │
│   │          │                             │   in tabs)  │   │
│   └──────────┴─────────────────────────────┴─────────────┘   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                         Kernel                               │
│  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │  Plugin Host    │  │  Command Bus + │  │ Render Stage │   │
│  │ (load/activate/ │  │  History (per  │  │ (MapLibre +  │   │
│  │   dispose)      │  │   task)        │  │   Deck.gl)   │   │
│  └─────────────────┘  └────────────────┘  └──────────────┘   │
│  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │ Extension Point │  │  Storage       │  │  Event Bus   │   │
│  │    Registry     │  │  (IndexedDB,   │  │   (pub/sub)  │   │
│  │                 │  │   scoped)      │  │              │   │
│  └─────────────────┘  └────────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │ extend via typed API
                              │
┌─────────────┬──────────────┬───────────────┬────────────────┐
│ TaskManager │ EditAdapter  │ LayerPlugins  │ ToolPlugins    │
│ (插件)      │ (后端适配)   │ (卫星/轨迹/   │ (打断/合并/    │
│             │              │  热力图/...)  │  画框/...)     │
└─────────────┴──────────────┴───────────────┴────────────────┘
```

---

## 3. 技术栈

| 用途 | 选型 | License |
|---|---|---|
| 前端框架 | React | MIT |
| 地图引擎 | MapLibre GL JS | BSD-3 |
| 大数据可视化 | Deck.gl | MIT |
| 矢量编辑 | nebula.gl / terra-draw(选一) | MIT |
| 图片标注 | Konva.js | MIT |
| 状态管理 | Zustand + Immer | MIT |
| 持久化 | IndexedDB(原生,可包 Dexie.js) | — |
| 构建 | 待定(Vite 倾向) | — |
| 语言 | TypeScript | — |

约束:**所有依赖必须开源、非商业 License**(MIT / BSD / Apache-2.0 优先)。

---

## 4. 指令协议

### 4.1 命令统一形态

```ts
type Command = {
  id: string                    // 客户端 uuid,用于去重与回溯
  type: string                  // namespaced 业务级类型,如 "edit.break-link"
  payload: object               // 命令参数,动态 schema,由后端/插件校验
  context: {
    taskId?: string             // 联机任务 id;离线为空
    backend?: string            // 哪个后端类型(edit/annot/eval)
    parentCommandId?: string    // 事务组合
  }
  optimistic?: Patch            // 本地乐观应用的 patch(可选)
  createdAt: number
}

type Patch = {
  // 类 JSON Patch / RFC 6902,后续可能扩展几何专用 op
  ops: Array<{ op: 'add'|'replace'|'remove'; path: string; value?: any }>
}
```

### 4.2 命令生命周期

```
                       ┌─────────────────────────────────┐
                       ▼                                 │
[draft] ──聚合 UI 事件──▶ [pending] ──本地 reducer 试算──▶[optimistic]
                                                          │
                                                          │ 同时
                                                          ▼
                                                      [sending]
                                                          │
                                  ┌── < 100ms ──────────┐ │
                                  │                     │ │
                                  ▼                     ▼ ▼
                          [computing]            [confirmed (server patch)]
                          (UI 动画提示)                  │
                                  │                      │ 与 optimistic 一致
                                  └─── server patch ────►│
                                                          ▼
                                                    [reconciled]
                                                          │ 不一致
                                                          ▼
                                              [以服务端为准 + 提示]
```

### 4.3 联机 / 离线双模式

| 维度 | 联机模式 | 离线模式 |
|---|---|---|
| 触发 | 任务从服务端拉取数据创建 | 本地导入 GeoJSON 文件 |
| 命令格式 | 同 | 同 |
| 执行路径 | 本地乐观 → 服务端权威 → reconcile | 本地 reducer 直出 patch |
| 撤销重做 | 作为命令发送给服务端 | 本地命令栈 |
| 数据持久化 | IndexedDB(本地缓存)+ 服务端 | IndexedDB |

### 4.4 命令粒度规则

- 命令是**业务级抽象**(`edit.break-link`、`annot.draw-bbox`),不是 UI 事件
- UI 事件流 → **命令构造层** → Command
- 一次拖拽 = 1 个 `move-node` 命令(mouseup 时构造)
- 一次"打断 link" = 多个原子命令组成的事务(用 `parentCommandId` 关联)

### 4.5 撤销重做

- 客户端维护命令历史栈(UI 展示用)
- `undo` / `redo` 本身就是命令:`{ type: "core.undo", payload: { targetCommandId } }`
- **联机任务**: undo 命令发服务端,服务端在它的历史上回退,返回反向 patch
- **离线任务**: 由本地 reducer 直出反向 patch
- 历史栈按任务隔离,持久化到 IndexedDB

---

## 5. 多后端适配

```
┌────────────────────────────────────────────────────┐
│   Core Commands (通用几何 CRUD: create/update/del) │
└────────────────────────────────────────────────────┘
            ▲                ▲                ▲
            │                │                │
┌───────────┴──┐   ┌─────────┴────┐   ┌──────┴───────┐
│ EditAdapter  │   │ AnnotAdapter │   │ EvalAdapter  │
│ (打断/合并)  │   │ (画框/标签)  │   │ (标注错误)   │
└──────────────┘   └──────────────┘   └──────────────┘
```

- **Core** 定义通用几何命令(create-feature / update-geometry / delete-feature / batch),所有后端共享
- **每个 Adapter 插件**声明自己的领域命令、endpoint、capabilities、工具栏配置
- **任务进入时**:根据 `task.backendType` 加载对应 Adapter,激活其贡献的工具与命令
- **Adapter 间隔离**:命令 namespace 强制(`edit.*` / `annot.*` / `eval.*`)防冲突

---

## 6. 插件系统

### 6.1 Manifest 规范

```ts
type PluginManifest = {
  id: string                    // 全局唯一,kebab-case
  name: string                  // 显示名
  version: string               // semver
  apiVersion: string            // 兼容的 kernel API 范围(semver range)
  entry: string                 // ES Module URL 或本地路径
  permissions: Permission[]     // 声明使用的能力
  contributes: Contributes      // 扩展点贡献
  dependencies?: {              // 依赖的其他插件
    [pluginId: string]: string  // semver range
  }
}

type Permission =
  | 'storage'        // 访问 scoped IndexedDB
  | 'commands'       // 注册/执行命令
  | 'events'         // 订阅/发布事件
  | 'network'        // 自行发起 HTTP 请求
  | 'tasks'          // 读取/管理任务
```

### 6.2 扩展点

| 扩展点 | 贡献内容 |
|---|---|
| `panels` | 左/右栏的 Tab 或 section(声明 slot, id, title, component) |
| `layers` | 数据源 + 渲染器(Deck.gl Layer)+ 图层控制 UI |
| `tools` | 工具栏按钮 + 鼠标/键盘交互 handler |
| `commands` | 命令 type + 本地 reducer + 远端 endpoint(可选) |
| `backendAdapters` | 一组配置(命令集 + endpoint + capabilities) |
| `importers` / `exporters` | 文件格式读写(GeoJSON 内置) |
| `propertyEditors` | 针对特定属性类型的 widget |
| `viewModes` | 中栏的可切换模式(地图 / 图片标注 / ...) |

### 6.3 插件分发

支持三种来源:

1. **远程 URL 加载**(B,主路径):配置 plugin registry URL,manifest 与 entry 经由 HTTP 加载
2. **本地文件夹加载**(C):通过 File System Access API 选目录,读 manifest + 入口
3. **内置**(A,兜底):打包进主 bundle,可启用/停用但不可卸载

加载方式:**动态 `import()`** ES Module(适用于 B 和 C)。

### 6.4 信任模型

**Fully Trusted** —— 插件直接访问 kernel API,无沙箱。

后果与约束:
- 用户须信任插件作者(目前是作者自己写)
- 插件可能搞崩主应用,需要在加载时做最基本的 try/catch 隔离
- 后续如需引入第三方插件,再设计沙箱方案(不影响当前架构)

### 6.5 生命周期

```
[discovered] ── load manifest ──▶ [validated] ── import entry ──▶ [loaded]
                                                                       │
                                                            activate() │
                                                                       ▼
                                                                  [active]
                                                                       │
                                                            dispose()  │
                                                                       ▼
                                                                [disposed]
```

每个插件导出:

```ts
export default {
  async activate(ctx: PluginContext): Promise<Disposable> {
    // 注册 contributions, 订阅事件, 等
    return {
      dispose() {
        // 必须清理所有 contributions、监听器、WebGL 资源、IndexedDB handle
      }
    }
  }
}
```

### 6.6 热插拔关键纪律

1. **每个 contribution 必须返回 `dispose()`**,无一例外
2. **插件 state 隔离**:默认 scoped 到插件 id,跨插件协作走事件总线或显式依赖
3. **命令 type 强制 namespace**(如 `edit.break-link`)
4. **API 版本化**:manifest 声明 `apiVersion`,kernel 不兼容时拒绝加载
5. **资源清理责任在插件自己**:WebGL layer、Map 事件监听、定时器、订阅,卸载时全部撤销

---

## 7. UI 布局

### 7.1 三栏结构

```
┌─────────┬─────────────────────────────┬──────────────┐
│  LEFT   │           CENTER            │    RIGHT     │
│         │                             │              │
│ Tasks   │   ┌─Map Mode─────────┐     │  [Layers]   │
│ (插件)  │   │                  │     │  [Properties]│
│         │   │   MapLibre +     │     │   (Tabs)     │
│ Filters │   │   Deck.gl        │     │              │
│  & 搜索 │   │                  │     │              │
│         │   └──────────────────┘     │  动态内容    │
│         │   ┌─Image Mode──────┐      │  ↑ 由当前    │
│         │   │  Konva 浮动     │      │    选中态    │
│         │   │  (可关闭)       │      │    决定      │
│         │   └─────────────────┘      │              │
└─────────┴─────────────────────────────┴──────────────┘
```

### 7.2 行为细节

- **中栏**:**模式切换**(地图模式 / 图片标注模式),不分屏。图片标注模式下 Konva 浮动层在 MapLibre 之上,关闭后回到地图模式。
- **右栏**:
  - 无选中要素 → 显示**图层列表 Tab**(默认)
  - 选中要素 → 自动切换或新增**属性 Tab**
  - 属性面板**schema-driven**(由当前要素的属性结构动态渲染)
- **左栏**:任务列表(任务管理插件贡献),需支持**筛选与过滤**

---

## 8. 持久化

使用 **IndexedDB**,所有持久化经由 kernel 提供的 `Storage` API,自动 scoped 到调用方插件 id。

### 8.1 数据分区

```
mme-db
├── tasks/                     # 任务元数据(任务管理插件持有)
├── command-history/<taskId>/  # 每任务的完整命令历史(都存)
├── snapshots/<taskId>/        # 任务数据快照(用于快速恢复)
├── plugins/<pluginId>/        # 各插件的 scoped 存储
└── meta/                      # kernel 自身配置(已加载插件、用户设置等)
```

### 8.2 命令历史

- **全量保存**(用户判断"不会太大")
- 按任务隔离
- 刷新页面后能恢复命令栈与 undo/redo 能力
- 联机任务下,本地历史与服务端历史需对齐(后续设计校对机制)

---

## 9. 关键约束与原则

| 原则 | 说明 |
|---|---|
| Kernel 业务无知 | Kernel 不感知"编辑/标注/评测"等业务概念,这些只能由插件引入 |
| 命令是协议 | 命令 schema 是前后端共享的契约,变更要兼容老命令 |
| 一切可 dispose | 任何分配的资源、注册的回调,都必须有清理路径 |
| Namespace 强制 | 命令 type、扩展点 id、事件名,均须插件 id 前缀 |
| 开源 License Only | 任何依赖加入前必须确认 License,排除 SSPL/BSL/商业 |

---

## 10. 实现进度

> 截至 2026-05-24(已完成"核心编辑"里程碑)

### 已落地

**项目工程:**
- Vite 6.4 + React 19.2 + TypeScript 5.9 (strict),包管理 pnpm 11

**Kernel (`src/kernel/`):**
- `PluginHost`: `load` / `unload` / `list` / `isLoaded` / `getLoadedIds` / `subscribe`,自动跟踪并 dispose 插件 contributions
- `ExtensionRegistry`: `registerPanel(slot, …)`,slot 索引,`subscribe` 通知 UI 重渲染
- `RenderContext`: `setMap` / `getMap()` 让插件 await 到 MapLibre 实例
- `CommandBus`: `register` / `dispatch` / `undo` / `redo` / `canUndo` / `canRedo` / `subscribe`;dispatch 截断 forward history,命令 apply 返回 `Disposable` 作为 undo
- `FeatureStore`: `set` / `get` / `delete` / `subscribe(sourceId 变化)` / `findFeature(sourceId, featureId)`;每个 sourceId 一份 FeatureCollection
- `types.ts` 定义 GeoJSON 类型(自带,不依赖 `@types/geojson`)+ `PluginManifest` / `PluginContext` / `Plugin` / `Disposable` / `Extensions` / `PanelContribution` / `Commands` / `Features`
- `instance.ts` 暴露全局单例 `host` / `extensions` / `renderContext` / `commandBus` / `featureStore`

**UI Shell (`src/components/`):**
- `Layout` 三栏 CSS Grid (header 48px,列宽按 `PanelMode` 动态切换)
- `Layout` 支持三态:`pinned`(占网格) / `peek`(fixed 触发条 + CSS hover 滑入) / `hidden`(完全不渲染)
- `Header` 含 Undo/Redo(订阅 CommandBus,disable 联动)、Left/Right 三态按钮组、hello-world Load/Unload、已加载插件列表
- `MapView` 接入 MapLibre GL 5.24,OSM raster 默认底图,初始化后注册到 `RenderContext`
- `RightPanel` Tab 切换 `right.layers` / `right.properties`,空态显示 hint
- `LeftPanel` placeholder
- `PanelMount` 适配命令式 `render(host) → Disposable` 到 React 生命周期

**演示插件:**
- `plugins/hello-world`: 通过 `extensions.registerPanel` 注册一个 panel(手动 Load/Unload)
- `plugins/geojson-loader`: App 启动时自动加载;贡献 `right.layers`;支持"加载样例路网"和"从文件加载";数据走 `FeatureStore`,订阅器把变更 setData 到 MapLibre
- `plugins/edit`: App 启动时自动加载;注册 4 条编辑命令(`edit.delete-feature` / `edit.move-node` / `edit.break-link` / `edit.update-property`);选中可视化(高亮 + 节点把手);贡献 `right.properties` 显示并编辑属性;键盘绑定 Del / Esc / Ctrl+Z / Ctrl+Y

**样例数据:**
- `public/sample-roads.geojson` 由 `scripts/fetch-osm-roads.mjs` 从 Overpass API 拉取(上海局部 838 条 OSM way)

### 扩展点实现状态

| 扩展点 | 状态 |
|---|---|
| `panels` (`left` / `right.layers` / `right.properties`) | ✅ 已实现 |
| `commands` | ✅ 已实现(CommandBus + register/dispatch/undo/redo) |
| `layers` | ⚠️ 部分(geojson-loader 直接调 `map.addSource`,未抽象 layer 扩展点) |
| `tools` | ⏳ 未实现(下一里程碑) |
| `backendAdapters` | ⏳ 未实现 |
| `importers` / `exporters` | ⚠️ 部分(geojson-loader 包含 GeoJSON 导入) |
| `propertyEditors` | ⚠️ 部分(edit 插件硬写了通用 input,未抽象成扩展点) |
| `viewModes` | ⏳ 未实现 |

### 已知简化(后续要补)

- 无 manifest 校验,无 `apiVersion` 协商
- 信任模型:零隔离(符合 fully trusted 设计)
- IndexedDB / 持久化:**未接入**(刷新即丢)
- 命令历史持久化:未实现(技术设计里说"都存")
- 插件加载:仅 Vite 同包 `import()`;远程 URL / FSAPI 加载未实现
- 编辑限制:节点编辑仅 LineString;打断仅能在已有顶点处切,且不能是端点;无拓扑联动(共享端点的多条线动一根不带其他)
- 性能:节点拖动每帧触发 setData,800 features 边界上可能卡;未加 rAF 节流
- break-link 生成的 id 含时间戳,跨 undo/redo 周期同一条"断开"会产生不同 id,长期持久化前要换 UUID
- 没有"添加要素"工具(画点/线/面)
- 没有 toolbar:目前所有编辑入口都嵌在右栏属性面板里,只在选中要素时可见

---

## 11. 待办与开放问题

### 立即下一步(用户已对齐)
- [x] 目录结构与最小骨架(hello world 插件,跑通 load/activate/dispose)
- [x] 三栏 UI shell + MapLibre + 右栏 Tab + 一个 panel 扩展点
- [x] 选定构建工具(Vite)
- [x] GeoJSON 加载(本地文件 + 样例数据)
- [x] 左右栏 pinned / peek / hidden 三态
- [x] CommandBus + FeatureStore 接入 Kernel
- [x] 编辑命令:删除 / 移动节点 / 打断 / 改属性 + 撤销重做
- [ ] **编辑工具栏(下一里程碑)** —— 见下方设计草案
- [ ] 选定 nebula.gl vs terra-draw(或自研到什么程度再决定)
- [ ] IndexedDB 持久化:FeatureStore 数据 + 命令历史 + 选中态
- [ ] 任意点打断(投影到线段 + 插入新顶点)
- [ ] 添加要素工具(画点 / 画线 / 画面)
- [ ] 合并 link / 拓扑联动

### 编辑工具栏设计草案

**位置:**中栏顶部一条横向 toolbar(覆盖在 map 上,左上角),或 Header 下方一行。

**扩展点 `tools`(待实现):**

```ts
type ToolContribution = {
  id: string                  // 命名空间化,如 "edit.select" / "edit.draw-point"
  group?: string              // 同组互斥(同时只能激活一个),如 "edit"
  icon?: string               // 文字图标或图标名
  label: string
  shortcut?: string           // 键盘快捷键,如 "v"
  activate: (ctx: ToolContext) => Disposable
}

type ToolContext = {
  map: maplibregl.Map
  features: Features
  commands: Commands
  // 工具可在 activate 内挂载交互(click/drag/键盘),Disposable 负责清理
}
```

**Kernel 新增 `ToolRegistry`:**
- `registerTool(t): Disposable`
- `activate(id): void` — 自动 deactivate 同 group 其他工具
- `getActive(group?): ToolContribution | null`
- `list(group?)`、`subscribe(fn)`

**初版工具集:**
- `edit.select`(默认) — 当前 onClick 选中逻辑
- `edit.move-node`(可选 / 自动启用当选中是 LineString)
- `edit.break` — 当前"打断"按钮的逻辑,但成为正经一个工具
- `edit.delete` — 点击要素即删(危险,默认关)
- `edit.draw-line` — 画新线
- `edit.draw-point` — 画新点

**与现有 edit 插件的关系:**
- 把现在 edit/index.ts 里的 onClick 选中、break 切换、按钮逻辑拆成工具
- 命令注册保持不变(命令是数据动作,工具是触发器)
- 右栏属性面板继续保留,但"打断 / 删除"按钮可能移除(改走 toolbar)

### 进入实现前需澄清
- [ ] 图片标注的"图片"来源(地理对齐 vs 相机帧)
- [ ] 自定义带拓扑格式的字段结构与拓扑约束
- [ ] 后端通信协议(REST / WebSocket / SSE)
- [ ] 撤销重做命令在服务端的具体行为契约
- [ ] 插件依赖声明的解析策略
- [ ] 多语言、权限、认证

### 中长期议题
- [ ] 第三方插件场景下的沙箱方案(目前 fully trusted 够用)
- [ ] 命令历史与服务端的校对/同步机制
- [ ] 插件市场/registry 形态
- [ ] 大数据图层的瓦片化/分块加载策略
