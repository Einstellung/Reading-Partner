# 工具里杀进程，重启后写类工具不重跑，只得到一条 interrupted 错误

## 现象

Linux 真 app 上验三餐「工具里杀进程」：faux 让模型调 `add_shopping_items`，`__fauxToolDelayMs` 把它拖住，期间 SIGKILL。重启后回合接着写完了，但线程文件里那条工具回执是 `state: "error"`，购物清单没有加上那一项。换成 `search_conversations` 再跑一遍，重启后工具重跑（19 ms）、回执 `done`。

## 原因

pi-durable 恢复一个停在工具执行里的任务时，只有记下的和当前的 `replay` 策略都是 `"safe"` 才重跑（`pi-durable/dist/harness/tool.js`）。工具不写 `replay` 默认 `"unsafe"`，恢复时交给模型的是 `Tool … was interrupted and may have partially run` 的错误结果，模型据此接着说。app 里只有读类工具标了 `replay: "safe"`（`search_conversations`、`read_retell_outline`、`read_talk_outline`、observation 的两个等），三餐的八个工具全是写类。

## 解法

这是设计如此：写类工具可能已经写了一半，重跑会重复写。验「工具重跑接着写」要挑 `replay: "safe"` 的工具；验写类工具时，预期是 interrupted 错误加模型接着说，不是重跑。
