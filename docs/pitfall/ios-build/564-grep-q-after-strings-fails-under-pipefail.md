# 564 pipefail 下 `strings | grep -q` 找到了也算失败

## 现象

CI 里校验 .dev 包是不是 dev 模式：`set -euo pipefail; strings "$APP/$EXE" | grep -q "http://$DEV_HOST:$DEV_PORT" || fail`。devUrl 明明在二进制里，步骤却走了失败分支。

## 原因

`grep -q` 读到第一处匹配就退出，`strings` 还在往管道里写，收到 SIGPIPE，退出码 141。pipefail 让管道取最后一个非零退出码，整条管道就成了失败。二进制越大、匹配越靠前越容易撞上。

## 解法

先落文件再 grep：

```
strings "$APP/$EXE" > strings.txt
grep -q "http://$DEV_HOST:$DEV_PORT" strings.txt
```

或者去掉 `-q`、把输出丢进 `/dev/null`，让 grep 读完全部输入。
