# 基线口径（科研）

- engine: `cuber`（huazhechen/cuber）
- view: `human_single`（固定人眼位，约 U/F/R）
- scramble seed: `42` → `R' B2 D' R2 L B2 D R2`（页面以 seed 生成；若与此不一致以页面显示为准）
- 模型: `autotrust/JEV-27B-VL` via `POST /v1/decide`
- 默认公网: `https://jay-publications-dude-passed.trycloudflare.com`（cloudflared，无鉴权，可能变更）

自动跑汇报字段：是否解出、总步数、accepted/reject、avg latency、`oscillation`/`near_miss` 次数。
