# 源码里一个裸 NUL 字节，整个文件对 grep 消失

## 现象

一次死代码审计判定 `src/ui/components/shelf/cover-source.ts` 没有任何 import 方，准备
删掉。实际上 `src/ui/components/shelf/useCovers.ts:9` 就 import 它的 `coverUrl`，而
`grep -rn coverUrl src` 一行都不打印。

`cat` 那个文件也看不出异常：出问题的第 23 行显示成 `.join("")`，像个空串分隔符。

`git diff` 也一样：改动这个文件只打印 `Binary files a/… and b/… differ`。

## 原因

第 23 行的分隔符是直接写进源码的 0x00 字节，不是 `\0` 转义。带 NUL 的文件对 grep 是
二进制，整份内容退出匹配输出，而"文件被跳过"这件事没人告诉你：

- GNU grep 3.11 会说，但说在 stderr（`grep: x.ts: binary file matches`），stdout 一个
  字节都没有，退出码 0。管道、`2>/dev/null`、任何按 stdout 收结果的工具封装都吞掉这句。
- Claude Code 会话里的 `grep` 是套了 `-I` 的 ugrep，那句也没有，直接退出 1。

于是"grep 扫不到这个文件"和"这个符号没人用"在屏幕上是同一个样子。
`tests/platform/sync/merge.test.ts` 里三处 `bytes("\0binary…")` 是同一个写法。

## 解法

写成 `\0` 转义，运行时同一个字符串，源码变回文本（`file` 的判定从 `data` 回到
`ASCII text`）。

`tests/source-is-text.test.ts` 扫 `src/`、`tests/`、`scripts/` 下每个 `.ts`/`.tsx`，带
NUL 或不是合法 UTF-8 就红。

基于 grep 的审计（"这个导出没人用，删掉"之类）在下结论之前先确认扫得到全部文件：

```
comm -23 <(find src tests scripts -type f \( -name '*.ts' -o -name '*.tsx' \) | sort) \
         <(grep -rlI . src tests scripts | sort)
```

输出为空才算数。
