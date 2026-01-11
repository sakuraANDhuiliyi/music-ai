# 将 two-moons-main 的能力集成到本项目（Vue + Vite + Express）

目标：把 two-moons-main 中「音乐引擎/转谱/编辑器/AI」等能力，按可复用的最小闭包拆出来，逐步集成到当前主项目（`src/` + `server/`）中。

> 现状差异
- 当前主项目：Vue 3 + Vite + Tailwind（前端），Express + MongoDB + JWT + Multer（后端），API Base 默认 `http://localhost:3000/api`。
- two-moons-main：Next.js + React + TS（前端/后端一体），Supabase + AliOSS + JWT header（`authorization-auth`、`authorization-ai`），音乐编辑器大量是 React 组件（Valtio/MobX/Slate）。

结论：**优先集成“纯工具/纯渲染”模块（可直接复用），其次是“可改 UI 的交互组件”，最后才是“强绑定 React/Slate/Valtio 的编辑器大组件”。**

---

## 1. 推荐集成顺序（最稳妥）

### 阶段 A（低风险，高复用）：工具链 + 五线谱渲染
1) **ABC 渲染五线谱（StaffNotation）**
- 价值：你现有项目里已经有“音频转谱/钢琴演奏”等页面，五线谱渲染是最通用的展示能力。
- two-moons-main 依赖：`abcjs`
- 迁移方式：把 React 组件改写为一个 Vue 组件（成本低），仅保留 `abcjs.renderAbc` 调用。

2) **简谱/和弦/旋律 → ABC 的转换工具**
- 价值：把你的“乐句/和弦进行”统一成可渲染谱面。
- two-moons-main 文件：`utils/musicParser.ts`, `utils/abcConverter.ts`
- 迁移方式：优先抽离成 `src/utils/music/*` 的纯函数（无 React 依赖）。

3) **MIDI ↔ beat/秒 的转换、导出**
- 价值：你的项目若要支持 MIDI 导入/导出或“录音转 MIDI”后编辑，这部分是必需底座。
- two-moons-main 文件：`utils/midiConverter.ts`, `utils/midiExporter.ts`
- 依赖：`@tonejs/midi`

### 阶段 B（中风险）：播放引擎 MoaTone（可选）
4) **MoaTone（替代 Tone.js 的轻量播放/Transport）**
- 价值：统一播放调度（lookAhead/scheduleRepeat），给“和弦试听/乐句播放/MIDI roll 播放”提供底层。
- two-moons-main 文件：`utils/MoaTone.ts`
- 风险：音频系统在浏览器差异、用户手势解锁、时钟精度；需要你现有页面做适配。

### 阶段 C（高风险）：编辑器 UI（强绑定 React）
5) **MoaRoll（钢琴窗/步进序列器）**
- two-moons-main：MobX Store + React UI（键盘组件）。
- 建议：
  - 先复用 Store/数据结构与播放调度逻辑；
  - UI 在 Vue 里重写键盘/网格（或短期用“React Island/微前端”方式嵌入）。

6) **MidiPianoRoll（MIDI 编辑器）**
- two-moons-main：React + Valtio + 大量鼠标交互。
- 建议：除非你强需求“编辑 MIDI”，否则不要先迁；或者直接把 two-moons-main 作为独立子应用接入。

7) **LuvEditor（Slate 富文本 + roll/img/bili/note 嵌入）**
- 强绑定：React + Slate + 插件体系。
- 建议：仅当你需要“文章编辑器 + 嵌入乐谱/roll”时再做；优先用 iframe/独立路由方式复用。

---

## 2. 三种集成策略（从易到难）

### 策略 1：抽离“纯能力包”（推荐）
把 two-moons-main 中与框架无关的部分，整理成主项目的 `src/utils/music/`：
- `musicParser`（简谱语法解析）
- `abcConverter`（转换为 ABC）
- `midiConverter` / `midiExporter`
- （可选）`MoaTone`

优点：不引入 React/Next，最稳定；缺点：编辑器 UI 要自己做。

### 策略 2：React Island（局部嵌入 React 组件）
在 Vue 页面里挂载一个 DOM 容器，用 `react-dom` 渲染某个 React 组件（如 MoaRoll/MidiRoll/LuvEditor）。

优点：复用 UI 最大；缺点：打包/样式/路由/状态会复杂（Vite 里同时跑 Vue+React 可行，但工程复杂度显著上升）。

### 策略 3：子应用/微前端
two-moons-main 保持独立部署（或同域不同路径），在主项目里通过跳转/iframe/反向代理接入。

优点：最快上线；缺点：体验割裂、鉴权与数据要做单点/桥接。

---

## 3. 后端对接：从 Next API 到 Express（建议映射）

two-moons-main 的接口主要是：AI、上传、用户同步。
你的主项目后端是 Express，所以推荐：

### 3.1 AI（SSE 流式 creator）
- two-moons-main：`/api/ai-creator`（SSE） + `authorization-ai`
- 你可以在 Express 新增：`GET/POST /api/ai/creator`，以 SSE 转发大模型流。
- 前端（Vue）用 `fetch-event-source` 或原生 `EventSource`（若用 GET）。

### 3.2 上传
- two-moons-main：AliOSS
- 你现有：Multer 本地存储（`/uploads`）
- 建议：短期先继续用 Multer；当你要上云再替换存储层。

### 3.3 同步（IndexedDB ↔ 云）
- two-moons-main：IndexedDBManager + `/api/user/sync-data`
- 你现有：MongoDB 用户表（可加一个 `userData` 字段做 JSON blob + timestamp）
- 建议：如果你真的需要“多端同步”，可以把它迁成 Mongo 版本；否则先只做本地保存。

---

## 4. 最小落地示例（建议你先选一个）

### 选项 A：在 `AudioToSheet` 页面加“五线谱预览”
- 引入 `abcjs`
- 新增一个 Vue 组件 `StaffNotation.vue`，输入为 `abc` 字符串
- 后端不动

### 选项 B：把“和弦进行/乐句”统一成 ABC 并可播放
- 迁移 `musicParser/abcConverter` 到 `src/utils/music/`
- 现有页面把内容转成 ABC → StaffNotation 渲染
- 播放先用你现有 AudioEngine 或再接 MoaTone

### 选项 C：接入 Mooner（搜索+创作+问答）到 Vue
- 前端做一个 Modal（三个 tab：search/create/qa）
- 后端新增 AI SSE 转发接口
- 本地数据源先接你现有 Project/乐谱数据结构

---

## 5. 你需要给我一个选择（我就能开始真正落地迁移）
请你在下面三项里选 1 个，我就按“最小可运行”把代码搬进主项目：
1) StaffNotation（abcjs 五线谱渲染）+ ABC 工具链
2) Mooner（AI SSE 创作）接入到现有 Vue（含后端转发接口）
3) MoaTone 播放引擎先落地到 `PianoPlay`/`Studio`
