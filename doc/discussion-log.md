# MME 需求与架构讨论记录

> 本文档按对话轮次记录 MME(Map Editor)项目从零开始的需求澄清与架构决策过程。  
> 目的是保留**决策上下文**(包括被否决的方案与理由),便于后续迭代时回看"当初为什么这么定"。
>
> 与技术设计文档 [`technical-design.md`](./technical-design.md) 的关系:本文记录**过程与权衡**,技术设计文档记录**当前生效的设计**。

---

## Round 1 — 初始需求陈述

### 用户输入要点

提出一个地图编辑器,需求初稿:

1. **独立产品**:可独立运行,有渲染和编辑地图数据的能力
2. **核心编辑能力**:点/线/面绘制与调整,可在图片上做标注并输出特定格式
3. **指令化记录**:从服务获取数据 → 编辑动作转为指令 → 提交服务 → 服务返回修改后数据 → 合并到前端(用户标注"这部分要详细讨论")
4. **多后端对接**:同一前端可对接编辑后端、标注后端、评测后端等
5. **三栏布局**
   - 左栏:个人任务(编辑/标注/评测)、收藏
   - 中栏:地图主视图 + 图层 + 编辑标注工具
   - 右栏:数据图层面板(底图/卫星/轨迹/热力图/行车记录仪轨迹);选中要素时显示属性

### Claude 的分析与提问

确认需求骨架后,提出几组关键问题:

- **图片标注的"图片"是地理对齐的栅格,还是无地理参考的相机帧?**(决定底层渲染路径)
- **指令化模式选哪一种?** 列出四种风格:
  - A. 命令日志(Command Sourcing):服务端权威,前端是 view
  - B. 操作变换(OT):适合多人协作
  - C. CRDT:适合离线 + 多人
  - D. 乐观更新 + 校验:适合单人高交互
- **是否多人协作 / 是否离线 / 撤销重做位置 / 服务端返回形态 / 命令粒度?**
- **多后端是只换 endpoint 还是数据模型与命令语义都不同?**
- **三栏的细节**:中栏单视口还是分屏?右栏无选中时显示什么?
- **技术栈未决项**:地图引擎、前端框架、运行形态(Web/桌面)、数据格式、属性 schema 是否动态

---

## Round 2 — 指令协议、布局、技术栈约束澄清

### 用户回复要点

**指令协议(对应 Round 1 的 point 3 详谈):**
- 核心操作要即时反馈(本地立即渲染)
- 复杂操作需要后端联动计算 → UI 显示"计算中"动画
- 已有 < 100ms 响应的高性能后端
- **不需要多人协作**
- 核心操作支持**离线编辑**(本机导入文件)
- 撤销重做**走服务端**(联机任务时)
- 服务端返回**增量数据**(patch)
- 命令是**业务级抽象**(如"打断 link"),用户操作与命令是 N:M 关系

**布局:**
- 中栏**模式切换**,不分屏
- 图片标注可能是**浮动在地图上**,标注完关闭
- 右栏无选中时显示图层列表
- 用户提出**用 Tab 切换属性面板和图层面板**
- 左栏需要**筛选/过滤**

**技术栈约束:**
- 主要 2D 编辑
- 性能要好
- **必须免费/开源**,不接受商业 License
- **排除 OpenLayers 和 Cesium**
- 纯 Web
- 矢量数据主要 GeoJSON,也有自定义带拓扑的格式
- 属性是**动态 schema**

### Claude 的分析

修正一个用词:用户说"C+D 混合",但 C 是 CRDT(多人协作场景),既然不要多人协作,实际想要的是 **D(乐观更新+服务端权威) + 离线本地命令日志**。后者比 CRDT 简单很多,无需引入合并冲突解决等复杂机制。

提出指令协议草案:
- 统一的 Command 形态(`id / type / payload / context / optimistic`)
- 命令生命周期状态机:`draft → pending → optimistic + sending → confirmed → reconciled`
- 复杂操作进入 `computing` 状态触发 UI 动画
- 离线模式跳过 `sending/computing`,本地 reducer 直出 patch
- 撤销重做作为命令发送给服务端
- 多后端通过 Core(通用几何命令) + Adapter(领域命令)分层

提出技术栈倾向:
- MapLibre GL JS(Mapbox GL 商用后用其开源 fork)
- Deck.gl 做大数据图层
- nebula.gl 或 terra-draw 做矢量编辑
- Konva.js 做图片标注
- 后续需要确认前端框架等子项

### 待决问题(交回用户)

1. 前端框架(倾向 React 因 Deck.gl 生态)
2. 命令栈是否持久化
3. 离线模式的文件格式
4. 任务状态隔离粒度
5. Adapter 加载方式(编译期内置 vs 运行时插件)

---

## Round 3 — 框架与插件化重大决策

### 用户回复要点

1. **前端框架:React**
2. **命令栈需要持久化**(刷新后可恢复)
3. **离线文件格式:GeoJSON**
4. **按任务隔离**(每任务独立命令栈与状态)
5. **Adapter 运行时可热插拔** —— 同时透露:**"我会单独做一个任务管理的插件,所以整个架构要能够支持插件化,我可能做很多插件"**

### Claude 的分析

第 5 点是一个**会重塑整个架构骨架的承诺**,不只是 Adapter 一个层级 —— 意味着任务管理、图层、工具、面板、导入导出等**都将作为插件**实现。核心 (kernel) 必须极度精简,只做:

- 插件宿主(加载/激活/卸载)
- 渲染主舞台
- 命令总线 + 历史栈
- 扩展点注册表
- 持久化(scoped)
- 事件总线

并提前确立热插拔的关键纪律:
- 每个 contribution 必须返回 `dispose()`(防 WebGL / 事件监听器泄漏)
- 插件 state 隔离,跨插件协作走事件总线
- 命令 type 必须 namespace
- 插件 API 必须版本化

提出扩展点目录草案:`panels / layers / tools / commands / backendAdapters / importers / exporters / propertyEditors / viewModes`。

提出插件 manifest 草案(JSON 声明 `contributes`)。

### 待决问题(交回用户)

1. **插件分发方式**:内置(A)/ 远程 URL 加载(B)/ 本地文件夹加载(C)
2. **插件信任模型**:fully trusted vs iframe 沙箱
3. **命令栈持久化粒度**:全量 / 最近 N 条+snapshot / 联机只存指针离线存全量
4. **状态管理库**:Redux Toolkit vs Zustand

---

## Round 4 — 最终关键决策

### 用户回复要点

1. 插件分发:**B + C**(远程 URL + 本地文件夹),A 兜底
2. 信任模型:**fully trusted**
3. 命令栈持久化:**都存**(不会太大)
4. 状态管理:**Zustand**(听 Claude 推荐)

### 当下结论

所有主要架构决策对齐完毕。下一步:
- 输出本讨论记录文档与技术设计文档(本步)
- 之后:输出目录结构 + hello world 插件的最小骨架,跑通插件加载/激活/卸载链路

---

## Round 5 — 从骨架到 UI Shell(实现)

### 输入与目标

用户说"继续吧"开启实现,后续追加"一次性把整个界面写出来"。本轮把范围明确为**视觉骨架 + 插件生命周期 + 一个真正贡献到 panel 的演示**,不碰命令总线、Deck.gl、Konva、IndexedDB 等。

### 实际产出

**第一段(scaffold + 生命周期验证):**
- 选定 Vite + React 19 + TypeScript strict + pnpm 11
- 写出最小 `PluginHost`(load / unload + 错误处理)
- `Plugin` 接口:`activate(ctx) → Disposable`
- hello-world 插件直接操作 `mountPoint` DOM,验证 activate/dispose 链路
- App 上挂 Load/Unload 按钮,在浏览器里能看见元素出现/消失

**第二段(UI shell + 扩展点雏形):**
- 三栏 CSS Grid 布局,Header 48px,左 280 / 中 flex / 右 320
- 中栏接入 MapLibre GL 5.24 + OSM raster 底图
- 右栏 Tab 切换 Layers / Properties,empty hint 占位
- 新增 `ExtensionRegistry`,引入 panel 扩展点(slot:`left` / `right.layers` / `right.properties`)
- `PluginContext` 由 `mountPoint` 升级为 `extensions`,更贴近最终架构
- `PluginHost` 自动跟踪每个插件 register 出来的 contributions,unload 时统一 dispose
- hello-world 改写为 `registerPanel`,贡献一个 `right.layers` 区段(命令式 render → Disposable)
- React 侧用 `useSyncExternalStore` 订阅 host / registry 的变化

### Claude 决策与权衡

- **单包工程起步**: 暂不引 monorepo / workspaces,第二个真插件出现时再切
- **插件加载只走 Vite 同包 `import()`**: 远程 URL / FSAPI 加载是已确认目标,但本轮先验证生命周期,避免一上来就背模块联邦
- **`PluginHost.subscribe` 返回 `() => void` 而非 `Disposable`**: 这是观察者订阅,不是资源,概念上区别于 `Disposable`(资源/contribution 的清理)。两种 API 共存,职责更清晰。
- **`useSyncExternalStore` 的 snapshot 稳定性**: registry 内部用 `bySlot` 缓存,host 内部用 `getLoadedIds()` 缓存数组,避免每次都生成新引用导致无限重渲染。
- **panel 用命令式 `render(host) → Disposable`**: 不强制插件用 React,允许 vanilla JS / 第三方框架。React 侧用 `PanelMount` 适配生命周期。

### 验证

- `npx tsc --noEmit` 干净
- Vite dev server 启动正常,所有模块以 200 响应
- 浏览器视觉确认由用户完成

### 未决遗留

- 插件无法访问 MapLibre 实例(下一里程碑要解决)
- 左右栏不可收起(下一里程碑要解决)
- 没有任何"加载真实数据"的能力

---

## Round 6 — GeoJSON 加载 + 可收起左右栏

### 输入与目标

用户三件事:
1. 把已完成内容写入文档(本轮先做了 Round 5 的记录)
2. 开发"加载本地 GeoJSON"功能,并从 OSM 导一份路网作样例数据;编辑功能后续将围绕这份数据演示
3. 左右栏三态:固定 / hover 弹出 / hover 也不出来(完全隐藏)

### 实际产出

**OSM 样例数据:**
- `scripts/fetch-osm-roads.mjs`: Overpass API 拉上海人民广场 bbox (121.465~121.485, 31.225~31.245) 内的道路 ways,转 GeoJSON LineString
- 第一次请求 Overpass 返回 406,加 `User-Agent` + `Accept: application/json` 后通过
- 产物:`public/sample-roads.geojson`,838 条路,~315 KB(ODbL 归属)

**Kernel 扩展 — RenderContext:**
- 新增 `src/kernel/render-context.ts`:`setMap(map | null)` / `getMap(): Promise<Map>`
- `MapView` 初始化后 `renderContext.setMap(map)`,卸载时传 `null` 并 `map.remove()`
- `PluginContext` 新增 `getMap()` 字段,转发给 `renderContext.getMap()`
- 取舍:**Kernel 直接依赖 maplibre-gl 类型**。设计文档已明确"渲染舞台是 kernel 一部分",这种耦合可以接受。如果未来要替换渲染引擎,这里是一个变更点。

**geojson-loader 插件 (`src/plugins/geojson-loader/`):**
- 贡献到 `right.layers` 的一个区段
- 两个动作:加载 `/sample-roads.geojson` / 从本地文件读取(`<input type="file">`)
- 自动识别 LineString / Polygon / Point 几何,加三层 MapLibre layer (line/fill/circle),色板循环 5 色
- 计算或读取 `bbox`,调 `map.fitBounds`
- 已加载图层列表 + 删除按钮(逐图层移除 source + 三层 layer)
- dispose 时清理所有加过的 source/layer
- App 启动时通过 `useRef` 守卫的 `useEffect` 自动 load 这个插件(StrictMode 双跑安全)

**Layout 三态:**
- `PanelMode = 'pinned' | 'peek' | 'hidden'` 加在 `Layout` props
- 网格列宽根据 mode 动态:`pinned=280/320px`,其余 `0`
- `pinned`: 渲染原 `app__left` / `app__right` aside,占网格列
- `peek`: 渲染 `peek-zone` (fixed 定位 8px 触发条 + 内部 absolute 面板),用纯 CSS `:hover` 触发宽度扩张和面板 `translateX` 滑入
- `hidden`: 不渲染任何 DOM,网格列宽为 0
- `Header` 新增两组 `Pin | Peek | Hide` 按钮(`aria-pressed` 高亮当前)
- `App` 用 `useState` 持有两栏 mode,通过 props 下传

### Claude 决策与权衡

- **Peek 用纯 CSS `:hover`**: 比 JS 的 `onMouseEnter/Leave` 更稳。代价:鼠标快速离开时面板会"瞬移"回收(width 立刻收回 8px,而 transform 还在动画);视觉小瑕疵,后续可考虑 JS 加 delay。
- **geojson-loader 自动加载,hello-world 手动加载**: 前者是用户真要用的功能,后者保留为生命周期演示开关。两者都通过 plugin API 走完整流程,平等地证明扩展点。
- **panel render 用命令式 DOM 而非 React**: 与 Round 5 的设计保持一致 —— 插件不强制框架。geojson-loader 里 `innerHTML` + `querySelector` + 自维护 `renderList()` 状态,够用且与未来"远程加载第三方插件"的设计兼容。
- **`getMap()` 返回 Promise**: 插件可能在 map 初始化前 activate(尤其是 App 启动期自动加载),用 Promise 处理就绪态比同步 null-check 更简洁。
- **路网色板用循环数组,而非随机**: 可复现的视觉,方便后续测试。

### 验证

- `npx tsc --noEmit` 干净(过程中清掉一个未使用的 `maplibregl` 导入)
- Vite dev server HMR 重新加载,sample-roads.geojson / geojson-loader / App / 根 HTML 全部 200
- 浏览器视觉确认仍由用户完成

### 未决遗留

- "可加载真实数据" ✅ 完成,但**编辑能力**还没起步(下一里程碑)
- Peek 模式快速 hover-out 的小瑕疵
- 没有持久化任何状态(刷新页面后已加载图层会消失)
- 还没接入 Deck.gl / Konva / 命令总线 / IndexedDB

---

## Round 7 — 核心编辑功能落地

### 输入与目标

用户:"接下来开发核心编辑功能吧, 我想在样例数据上看看效果。"

通过 AskUserQuestion 对齐到**大档范围**:select / delete / move-node / break-link + **可编辑属性走命令**。引入 CommandBus + 撤销重做 + 右栏属性面板。

### 实际产出

**Kernel 新增:**
- `CommandBus`(`src/kernel/command-bus.ts`):`register` / `dispatch` / `undo` / `redo` / `canUndo` / `canRedo` / `subscribe`;dispatch 时截断 forward history;命令 apply 返回 `Disposable`,undo 即 dispose
- `FeatureStore`(`src/kernel/feature-store.ts`):每个 sourceId 一份 FeatureCollection,`set` / `get` / `delete` / `subscribe(sourceId 变化)` / `findFeature(sourceId, featureId)`
- 自定义 GeoJSON 类型(`Feature` / `FeatureCollection` / `Geometry` / `Position`),避免依赖 `@types/geojson`
- `PluginContext` 扩展:`commands` 与 `features` 字段

**geojson-loader 重构:**
- `addGeoJSON` 不再直接给 MapLibre 喂数据,而是写入 `FeatureStore` → 订阅 store 变化 → 自动 `setData`
- 移除图层用 `ctx.features.delete(sourceId)`,订阅器统一清理 MapLibre source/layer
- 入站数据自动给无 `id` 的 feature 分配字符串 id(`${sourceId}.fN`),保证选中链路稳定
- UI 列表加色块(swatch)

**edit 插件(全新,自动加载):**
- 注册 4 条命令:
  - `edit.delete-feature` — apply 删除,undo 在原索引插回
  - `edit.move-node` — apply 把 LineString 第 N 顶点改成 newCoord(幂等),undo 改回 oldCoord
  - `edit.break-link` — apply 在指定顶点把 LineString 拆成两条新 feature(新 id),undo 删两条加回原条
  - `edit.update-property` — apply 改 `properties[key]`,undo 还原(oldValue=undefined 时删 key)
- 选中: 点击 → `queryRenderedFeatures` 限定到所有 `${sourceId}.{line,fill,point}` 图层 → 命中 feature 的 source/id 记成 selection
- 选中可视化:`edit.selected` source 渲染高亮(粗黄线 / 大圆点),LineString 选中时另一个 `edit.vertices` source 渲染节点把手
- 节点拖动: `mousedown` 在 `edit.vertices` 触发,`e.preventDefault()` 关掉 map 拖拽;`mousemove` 直接改 FeatureStore 中的坐标(订阅器立即 setData 反馈视觉);`mouseup` 派发 move-node 命令(apply 幂等)
- 打断:右栏属性面板 LineString 时显示"打断"按钮 → 进入 break 模式 → 下一次点击在 LineString 内部顶点中找最近的、不能是端点 → 派发命令
- 属性面板:贡献到 `right.properties`,显示 id / geometry type + 每个 property 一行(key + input);input 失焦时派发 update-property;选中要素消失时清空选中态
- 键盘:Delete/Backspace 删除,Esc 取消选中/打断,Ctrl+Z undo,Ctrl+Y / Ctrl+Shift+Z redo;输入框聚焦时禁用,避免和文本编辑冲突
- 鼠标 grab/grabbing 光标反馈
- `document.mouseup` 兜底:鼠标移出 canvas 后释放也能正确收尾

**UI 接线:**
- `Header` 加 Undo/Redo 按钮组,`useSyncExternalStore` 订阅 CommandBus 状态;disable 状态联动
- `App` 自动加载 geojson-loader 和 edit 两个插件(`useRef` 守 StrictMode 双跑)
- CSS:`undo-redo`、`props` / `props-meta` / `props-row` / `props-input` / `props-actions`、`gj-swatch`

### Claude 决策与权衡

- **拖动直接改 FeatureStore + 订阅器 setData**(而非"拖动期间绕过 store"):简单,功能正确;代价是每个 mousemove 一次 setData(800 features ~5-15ms),拖动顺畅但不极致。**等真出现卡顿再加 rAF 节流**。
- **move-node 命令 apply 幂等**:dispatch 在 mouseup 时跑,state 已经在 newCoord,apply 设到 newCoord 是 no-op。但 history 把 `{old, new}` 全记录,undo / redo 都能正确反演。
- **break-link 在 apply 内部生成新 id**:redo 会再 apply 一次,产生**不同**的新 id。undo 的 closure 捕获的是当次 apply 的 id,所以 redo 后再 undo 仍然能正确删除"上一次的两条"。轨迹是对的,但跨 undo/redo 周期"同一条断开"的逻辑 id 会变 —— 后续如果做协作或持久化要重新设计 id 策略(用 UUID 入 payload)。
- **节点编辑只支持 LineString**(不含 Polygon ring / Multi*):MVP 范围。
- **打断只允许在已有顶点上切,且禁端点**:简化算法,无需把任意点投影到线段。后续要做"任意点切"需要计算 `pointToSegmentDistance` + 在 coords 中插入新顶点。
- **属性编辑走命令** + **input focus 防 re-render**:订阅器在 input 聚焦时跳过 panel re-render,避免拖动改坐标时把用户正在编辑的属性输入框冲掉。
- **设计原则验证**: 至此"业务级抽象命令"、"命令是协议"、"一切可 dispose"、"namespace 强制" 都在 edit 插件里得到验证。可作为后续 backend adapter 的参考样板。

### 验证

- `npx tsc --noEmit` 干净
- `pnpm-lock.yaml` 已生成
- Vite 重启 OK,8 个新模块 + sample-roads.geojson 全部 200
- 视觉与交互由用户在浏览器确认

### 未决遗留

- 没有显式的**编辑工具栏**(当前只在右栏属性面板里嵌按钮,且只有选中要素后才出现);用户已要求**下一里程碑做工具栏**
- 没有"任意点打断"
- 没有节点拖动节流(800 features 边界上可能有卡顿)
- 没有持久化(刷新即丢失)
- 没有"添加要素"(画点/画线)
- 没有"合并 link"
- 没有拓扑联动(共享端点的多条线动一根不带动其他)

---

## 关键 Alternatives 与否决理由汇总

| 项 | 选择 | 否决的 Alternatives | 理由 |
|---|---|---|---|
| 指令协议 | 乐观更新 + 服务端权威 + 离线本地日志 | CRDT / OT | 不需要多人协作,引入合并算法成本过高 |
| 地图引擎 | MapLibre GL JS | Mapbox GL JS v2+ | 商业 License,被用户排除 |
| 地图引擎 | MapLibre GL JS | OpenLayers / Cesium | 用户明确排除 |
| 状态管理 | Zustand | Redux Toolkit | 样板代码多;插件 scoped store 在 Zustand 下更易实现 |
| 信任模型 | Fully trusted | iframe 沙箱 | 沙箱性能/集成度差;插件均为可信作者 |
| 撤销重做 | 走服务端(联机) | 纯本地栈 | 服务端是命令历史权威源,本地栈在多任务/重连场景下易失真 |
| 服务端返回形态 | 增量 patch | 全量数据 / 反向命令 | 增量 patch 在性能(< 100ms 后端)和实现复杂度间取得平衡 |
| 中栏布局 | 模式切换 | 分屏 | 用户决定 |
| 任务管理 | 作为插件 | 内置 kernel | 用户明确表态要插件化 |

---

## 仍待澄清(进入实现前需补齐)

- 图片标注的"图片"具体是哪种来源?是否需要地理对齐?
- 自定义带拓扑格式的具体形态(link/node 的字段结构、拓扑约束)
- 多后端的具体 endpoint 协议(REST/WebSocket/gRPC-Web)
- 撤销重做命令在服务端的具体行为契约
- 插件之间是否允许声明依赖?(如某图层插件依赖某后端适配器)
- 多语言?权限/认证模型?
