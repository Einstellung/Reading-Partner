# 389 `cargo fmt` 会重排整个 crate，而这个仓库本来就不是 rustfmt-clean

## 现象

在 `src-tauri` 里改完三个文件跑一次 `cargo fmt`，`git status` 出来十个文件：
`atomic_fs.rs`、`image_proxy.rs`、`navigation.rs`、`oauth_callback.rs`、`voice.rs`
全被动过，一个我没打开过。改动是纯排版——一行拆成五行、`assert_eq!` 的参数各占一行。

## 原因

`cargo fmt` 不接文件参数也不看 git 状态，它按 crate 走一遍所有 `mod`。而这个仓库
从来没在 rustfmt 下跑过：现有代码里有大量超过 rustfmt 默认宽度的行，它们全是
rustfmt 眼里的待改项。于是一次格式化把"我的改动"和"整个 crate 的历史欠账"混进
同一个 diff，commit 里看不出哪一行是真的改了逻辑。

## 解法

别在这个仓库跑 `cargo fmt`。手写的时候照着周围的风格来，`cargo check` 管编译，
格式没有门禁。

真要格式化，只格式化改过的文件：`rustfmt --edition 2021 <file>`（它只动给它的
文件）。已经跑了的话，`git checkout --` 把没碰过的文件还原，再逐个看剩下的
diff——被重排的往往也包括你改的文件里跟你无关的那些函数。
