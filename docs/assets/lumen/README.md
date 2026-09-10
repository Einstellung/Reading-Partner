# Lumen 参考图留档

定案见 [66](../../66-Lumen.md)。这些是形象的参考，不是最终资产：切层和动画照它们做，颜色和比例以它们为准。

- `lumen-front.png` — 正面主图，其余几张的参考图。
- `lumen-three-quarter-left.png` / `lumen-three-quarter-right.png` — 左右 3/4，只转眼睛加身体侧倾。
- `lumen-asleep.png` — 睡着：身体压低摊宽，火苗垂下，光变暗。
- `lumen-thinking.png` — 思考：火苗更高，核心更亮。
- `lumen-sheet.png` — 上面五张拼的对照表。
- `concept-2026-08-26.jpg` — 2026-08-26 的「电电」概念图，Lumen 的前身。它定的八种情绪、五套日常动作和 token 喂养的能量条全部作废，留档是因为身体、眼睛、笑和火苗是从这张图上留下来的。

生成用 `gpt-image-2.5`，经 Right Code 中转（`https://right.codes`），2026-09-10。脚本 `gen.mjs`，密钥从 `/home/xinyuan/Documents/ppt-generation/.env` 读，不在脚本里。提示词在 `prompts/`：`master-noring.txt` 出 `lumen-front.png`，`set2-base.txt` 是四张状态图共用的前半段，`t-*.txt` 是各自的全文。四张状态图都以 `lumen-front.png` 为参考图生成；主图本身是第三轮候选的改图，前三轮候选没留档。
