# Music AI (毕业设计项目)

一个基于 `Vue 3 + Vite + Express + MongoDB` 的音乐创作与社区平台，包含：

- 在线创作与工程管理（Studio）
- AI 和弦/旋律生成
- 音频转键位文字谱（低配可运行）
- 教程与练习模块（和弦、音程、节奏等）
- 社区、评论、私信、通知、每日推荐
- 管理后台与超级管理员权限体系

## 技术栈

- 前端：Vue 3、Vue Router、Vite、Element Plus、TailwindCSS
- 后端：Express、Mongoose、JWT、Multer、WebSocket
- 数据库：MongoDB
- 可选 Python 服务：
  - `chord-service`（FastAPI + Transformers + Torch）
  - `tools/audio_to_sheet`（librosa 音频转谱脚本）

## 项目结构

```text
.
├─ src/                    # 前端源码
├─ server/                 # Node.js 后端
├─ chord-service/          # 本地 AI 和弦服务（可选）
├─ tools/audio_to_sheet/   # 音频转谱脚本（可选）
├─ public/                 # 静态资源
└─ .env.example            # 环境变量示例
```

## 环境要求

- Node.js 18+（建议 20+）
- npm 9+
- MongoDB（本地或 Atlas）
- Python 3.10+（仅在使用 Python 可选功能时需要）

## 快速开始（本地开发）

1. 安装依赖

```bash
npm install
```

2. 配置环境变量（在项目根目录）

```bash
copy .env.example .env
```

3. 编辑 `.env`，至少填写以下字段：

- `MONGO_URI`
- `JWT_SECRET`

4. 启动后端（终端 1）

```bash
npm run server
```

5. 启动前端（终端 2）

```bash
npm run dev
```

6. 打开浏览器

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:3000/api/health`

## 环境变量说明（核心项）

`.env.example` 已给出完整示例，常用项如下：

- `MONGO_URI`：MongoDB 连接串（必填）
- `JWT_SECRET`：JWT 签名密钥（必填）
- `PORT`：后端端口，默认 `3000`
- `AI_API_KEY`：大模型 API Key（用于 `/api/ai-creator`）
- `AI_MODEL`：大模型名称，默认 `glm-4.6`
- `AI_API_BASE`：OpenAI 兼容接口地址（可选）
- `AI_CHORD_SERVICE_URL`：本地和弦服务地址（如 `http://127.0.0.1:8001`）
- `MUSIC_API_BASE`：音乐代理 API 地址
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_USERNAME`：后端启动时自动创建或提权超级管理员

## 可选服务 1：本地 AI 和弦服务（chord-service）

仅当你要启用本地和弦模型时需要。

1. 进入目录并创建虚拟环境

```bash
cd chord-service
python -m venv .venv
.venv\Scripts\activate
```

2. 安装依赖（最小集合）

```bash
pip install fastapi uvicorn torch transformers pydantic safetensors
```

3. 启动服务

```bash
uvicorn app:app --host 127.0.0.1 --port 8001
```

4. 在根目录 `.env` 配置

```env
AI_CHORD_SERVICE_URL=http://127.0.0.1:8001
```

## 可选服务 2：音频转谱（audio_to_sheet）

后端接口 `/api/audio-to-sheet` 会调用 `python tools/audio_to_sheet/main.py`。

1. 安装依赖

```bash
pip install numpy librosa soundfile
```

2. 命令行单独测试（可选）

```bash
python tools/audio_to_sheet/main.py --input tools/audio_to_sheet/test.wav --output out.txt
```

## npm scripts

- `npm run dev`：启动 Vite 前端开发服务
- `npm run server`：启动 Express 后端
- `npm run build`：前端构建
- `npm run preview`：预览构建产物
- `npm run smoke`：运行基础 smoke 测试脚本
- `npm run cleanup:netease`：清理网易云相关缓存数据

## 常见问题

- 后端启动即退出并提示 `未找到 MONGO_URI`
  - 检查 `.env` 是否存在且 `MONGO_URI` 已填写。

- AI 生成功能提示未配置 `AI_API_KEY`
  - 在 `.env` 添加 `AI_API_KEY`，或配置并启用 `AI_CHORD_SERVICE_URL` 走本地模型。

- 音频转谱失败，提示无法启动 Python
  - 确认 `python` 已安装并加入系统 `PATH`。

- 导出 MP3 失败
  - 服务器需要安装 `ffmpeg` 并加入 `PATH`（用于 `/api/convert/mp3`）。

## 安全说明

- 不要提交真实 `.env` 到仓库。
- 生产环境请更换强 `JWT_SECRET` 与超级管理员密码。

