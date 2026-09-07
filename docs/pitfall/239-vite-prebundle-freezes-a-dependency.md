# vite 的依赖预构建缓存会冻住一个依赖的旧版本

现象：`git pull` 之后 app 启动弹 `Anthropic no longer offers claude-fable-5-1; switched to claude-fable-5.`，但磁盘上的模型表里 `claude-fable-5-1` 明明在——`bun -e` 直接调 `anthropicProvider().getModels()` 也能列出它。dev 下这条提示还弹两次。

原因：`node_modules/.vite/deps/` 里的预构建产物是几周前那次 dev 启动生成的，pi-ai 的模型表被整份内联进了那份 chunk。pull 只改了 `package.json` 和源码，没有人跑 `bun install`，`node_modules` 里的 pi-ai 还停在旧版本；vite 也没有重新预构建，dev server 读的仍是旧 chunk。于是 app 看到的模型表比磁盘上的旧，`enforceKnownModel` 如实判定这个模型不在目录里，换成同窗口里目录序第一的那个并写回盘——它干的是对的事，喂给它的表是过期的。弹两次是 `src/main.tsx` 的 `React.StrictMode` 在 dev 下把 effect 跑两遍，打包出来的不会。

解法：

- `bun install && rm -rf node_modules/.vite`，再重启 dev server。只跑 `bun install` 不够，预构建缓存不会因为 `node_modules` 变了就自己失效。
- 判断是不是这个坑：拿 `bun -e` 直接从 `node_modules` 读一次那份数据，和 app 里看到的对比。两边不一致就是缓存，不是代码。
- 被换掉的设置不会自己回来：`enforceKnownModel` 只在模型不可选时才动它，表恢复之后旧值已经不在盘上了，得手动选回去。
