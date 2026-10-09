# 测试里登记的站点适配器留给后面所有文件

## 现象

`tests/info/links/take.test.ts` 单跑绿，全量 `scripts/t.sh` 里拿 GitHub 链接的用例红：链接没走测试给的固定页面，被真的 GitHub 适配器认领，去取 `api.github.com`。

## 原因

bindery 的站点适配器登记表（`workshop/bindery/registry.ts`）是模块级 Map，`bun test` 全量在一个进程里跑。`tests/info/sources/drive-site.test.ts` 和 `tests/info/sources/plugins/arxiv-site.test.ts` 调 `registerSourceSiteAdapters()` 验启动登记，GitHub、Drive、arXiv 全部登记进去，没有撤销。之后跑的文件里 `siteAdapterFor` 都会认领这些站的链接。

## 解法

依赖路由的测试在 `beforeEach` 里清登记表：对 `registeredSiteAdapters()` 的每个名字登记一个 `claims: () => false` 的桩再立刻撤销，原来那个就没了（`take.test.ts` 的做法）。要用适配器的测试自己登记、自己撤销。

相关：[303](./303-a-boot-at-module-scope-registers-for-every-test-file.md)
