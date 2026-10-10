# pi-durable：每回合 reset() 之后，系统提示的每一段都重新写成 pi.system 条目

## 现象

pi-durable 1.1.0，回合开始前 `conversation.reset()`，下一次请求前 transcript 里在 `pi.user` 之后多一条 `pi.system`，内容是全部 section，不是只写变了的那段。每回合都这样。

## 原因

section 是否重发看 `PromptInput.shown`，即重放活跃 transcript 后已生效的 section；reset 之后活跃 transcript 从 reset 条目开始，里面没有任何 `pi.system`，所以每段都算新的。

## 解法

库的增长按「每回合写一份完整系统提示」估，换代阈值按实测定（docs/soul/87「换代」的估算没算这部分）。provider 侧的 prompt cache 不受影响：发出去的文本没变。
