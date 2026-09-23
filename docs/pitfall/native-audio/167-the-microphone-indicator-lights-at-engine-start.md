# 橙点在 engine.start() 那一步亮，不在 setActive 那一步

## 现象

想把按住说话的那一秒提前付掉（坑 166：press 到第一个 buffer 约 1000ms，其中约 690ms
是 `setVoiceProcessingEnabled(true)` 重建 IO 单元），前提是知道预热要付什么可见代价。

真机停在四个状态各自不动，看状态栏：

```
Off        session 未激活                          不亮
Session    setActive(true)，引擎没起、tap 没装      不亮
Engine     engine.start()，VPIO 已建，tap 没装      亮
```

`Tap` 和 `Recording` 两档没单独测——`Engine` 已经亮，后面的只会更亮。

## 原因

Apple 对触发点没有任何开发者文档。`AVAudioIONode.setVoiceProcessingEnabled(_:)` 的文档
只有一句话，麦克风指示器只有一篇面向用户的支持文章（"An orange indicator means the
microphone is being used by an app"），DTS 在开发者论坛被问到指示器时直接把人打发去
Apple Support Community。所以这条只能问出来，不能推。

推过两次，两次都错：先猜 `setActive` 就会亮（错，不亮），再猜引擎跑起来但不装 tap 不会亮
（错，亮）。边界在 `engine.start()`：session 激活只是拿到路由，输入 audio unit 真正跑起来
才算"在用麦克风"，和有没有人读那些 buffer 无关。

## 解法

**预热引擎必然点亮橙点**，没有免费的预热。那 690ms 花在 VPIO 上，而 VPIO 只有引擎跑起来
才建得成；只提前 `setActive` 省得下来的是 75ms，等于没省。

所以只剩两种形态：

- 切进语音模式就把引擎起来。每次按住都是快的，代价是用户还没开口橙点就亮了。
- 第一次按住时建，之后按住之间不 `stop()`（`stop()` 会释放 `prepare()` 分配的资源，
  `pause()` 不会）。橙点从用户第一次说话开始亮，一直到退出语音模式。第一次按住仍然付那
  一秒，之后每次都快。

取第二种：稳态收益一样，而橙点亮的时候用户确实刚说过话。第一种是在用户还没开口时就亮。

这条不能当稳定契约依赖——Apple 什么都没承诺，行为随时可以变。设计上假设"引擎在跑＝橙点
亮"，然后让亮得诚实。
