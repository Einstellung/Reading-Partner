# 代码仓库靠树深处的数字开头文件和版本号命名的发布说明被当成书

## 现象

GitHub 适配器把 `MervinPraison/PraisonAI` 读成整本书，README 里其实一个仓库内 md 链接都没有：认成书的是编号文件那条，五个 `src/praisonai-agents/docs/local-model-layer/0N-*.md` 设计笔记，藏在四层目录下。`amontlabs/lcu` 两条都过：README 链了 6 个文档，树里还有 22 个 `docs/releases/0.8.1.md` 这样的发布说明，文件名以数字开头。

## 原因

编号文件那条取的是递归的整棵树，README 所在目录下任何深度的 md 都算；「文件名以数字开头」也接住了版本号命名的文件。代码仓库里这两种都常见：编号的设计笔记、ADR、发布说明。

## 解法

没有 `SUMMARY.md` 时，README 的章节列表和编号文件都只在仓库以 md 为主时才算（README 所在目录下 md 至少占一半，图片不计）。PraisonAI 的 md 占 3%，lcu 占 29%，nanoGPT 17%，`robotbird/pi-durable-book` 98%。

*实测：2026-10-09*
