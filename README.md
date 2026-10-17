# Cuber VL × JEV-27B

私有实验页：合法 scramble + 固定人眼视角（`human_single`，约 U/F/R）→ 截帧 → JEV `POST /v1/decide` → cuber twist。

基于 [huazhechen/cuber](https://github.com/huazhechen/cuber)（MIT），增加 `vl.html` / `src/vl.tsx`、Vite 多页入口，以及 Python bridge（`tools/cuber_vl_bridge.py` + `tools/jev_client.py`）。

**任意电脑可测：** 默认走 `.env.example` 中的公网隧道 URL；本机只跑 Vite + 本地 bridge（bridge 负责拼 multimodal 请求并绕过浏览器 CORS）。

## 快速开始

### macOS / Linux

```bash
cp .env.example .env   # 已含公网 JEV_URL，可按需改 VL_BRIDGE_PORT
npm install --legacy-peer-deps
```

终端 1 — bridge（默认端口见 `.env` 的 `VL_BRIDGE_PORT`，一般为 `8767`）：

```bash
set -a && source .env && set +a && python3 tools/cuber_vl_bridge.py
```

终端 2 — 前端：

```bash
npm run dev
```

浏览器打开：**http://127.0.0.1:8765/vl.html**

### Windows PowerShell

```powershell
Copy-Item .env.example .env
npm install --legacy-peer-deps
```

终端 1：

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] } }
python tools\cuber_vl_bridge.py
```

终端 2：

```powershell
npm run dev
```

然后访问 **http://127.0.0.1:8765/vl.html**。

## 评测基线（科研口径）

与 [docs/baseline.md](docs/baseline.md) 一致，对比实验时请固定：

| 项 | 值 |
| --- | --- |
| engine | `cuber`（huazhechen/cuber） |
| view | `human_single`（固定人眼位，约 U/F/R，非展开图） |
| scramble seed | **42**（页面默认；8 步合法打乱） |
| 模型接口 | `autotrust/JEV-27B-VL`，经 bridge 转发 **`POST /v1/decide`** |

**自动/批量跑后建议汇报的 trace 字段：**

- 是否解出（solved?）
- 总步数（steps）
- accepted / reject 次数
- 平均延迟（avg latency）
- `oscillation`、`near_miss` 次数

更完整的约定与示例 scramble 字符串见 **[docs/baseline.md](docs/baseline.md)**。

## 仓库结构（摘要）

- `vl.html`、`src/vl.tsx` — VL 实验页
- `tools/cuber_vl_bridge.py`、`tools/jev_client.py` — 本地 CORS bridge
- `vite.config.ts` — 多页（`index.html` + `vl.html`），dev 端口 **8765**
- `.env.example` — `JEV_URL`、`VL_BRIDGE_PORT`（**勿提交 `.env`**）

## 许可

前端基于 [huazhechen/cuber](https://github.com/huazhechen/cuber)（MIT）。本仓实验页与 bridge 为科研私有用途。
