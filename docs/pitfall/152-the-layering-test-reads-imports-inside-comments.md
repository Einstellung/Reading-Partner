# 分层测试不剥注释，写在注释里的 import 也算一条依赖边

## 现象

`tests/layering.test.ts` 报了一个目录环，边指向的那一行是注释：

```
Directory dependency cycle: reading/lecture -> reading/prep -> reading/lecture
  reading/prep -> reading/lecture
      src/reading/prep/....ts imports "../lecture"
```

打开那个文件，`../lecture` 只出现在文件头注释里的一句 `// import { x } from "../lecture";`——没有任何代码 import 它。删掉注释里那一行，环就没了。

## 原因

`collectEdges()` 把文件当纯文本，直接对整份源码跑

```
/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g
```

没有任何剥注释的步骤。注释里的 `from "..."` 和代码里的 `from "..."` 对这个正则完全一样。命中的字符串再交给 `resolveEntry()` 做一次真的 `statSync`，路径存在就落成一条边。

所以只有"看起来像 import 且路径真的存在"才会中招：注释里提一句 `src/reading/lecture/live.ts` 这样的裸路径没事，写成带引号的 import 语句形式才有事。

## 解法

注释里不要写完整的 import 语句形式。要指别的目录，写裸路径（`reading/lecture/live.ts` 的 `loadChapterTable`）或者只写模块名，不要写 `from "../lecture"`。

这是设计成这样的，不是 bug：注释掉的 import 是一条随时会被取消注释的依赖，报出来比放过好。测试的失败信息会把文件名和 specifier 一起打出来，照着看就知道是注释还是代码——`IMPORT_RE` 上方的注释也写了这件事，只是踩到之前不会有人去读它。
