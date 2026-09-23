# /tmp 里的 idb venv 会被清掉一半，看起来还装着

现象：Mac 构建机上 `scripts/ios-sim.sh swipe`（以及 tap、press、native）报 `ModuleNotFoundError: No module named 'idb'`，而 `/tmp/idbvenv/bin/idb` 这个可执行文件还在、`ls /tmp/idbvenv/lib/*/site-packages` 还能看到 `fb_idb-1.1.7.dist-info`。看上去装过而且没被删。更坏的是 `ios-sim.sh` 只在 `up` 里对 idb 缺席打一句 warning，直接跑 `swipe` 不检查，于是触摸静默失效：脚本照常退出 0（`idb` 的 traceback 走 stderr，被 `>/dev/null` 吃掉），页面一动不动，量出来的滚动位置是 0，读起来像"WebKit 不接受这个手势"。

原因：macOS 会按空闲天数清 `/tmp` 里的文件，清的是文件不是目录树，所以 `bin/pip`、`site-packages/idb/` 这些天天不读的东西先没，`bin/idb` 这个壳脚本和 `*.dist-info` 反而留着。`ios-sim.sh` 头部注释里的安装命令就是 `python3 -m venv /tmp/idbvenv`，照抄一遍等于把同一个坑再埋一次。

解法：venv 建在家目录，用 `IDB` 环境变量指过去，`ios-sim.sh` 读 `${IDB:-/tmp/idbvenv/bin/idb}`。

```bash
python3 -m venv ~/idbvenv && no_proxy='*' ~/idbvenv/bin/pip install fb-idb
export IDB=$HOME/idbvenv/bin/idb
```

判据一句话：跑触摸之前先 `$IDB ui describe-point --udid <udid> 0 0`，出 JSON 才算装着。
