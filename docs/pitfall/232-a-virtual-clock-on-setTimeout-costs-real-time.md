# 232 虚拟时钟跑在 setTimeout 上，就还在花真实时间

## 现象

`tests/ai/limiter.test.ts` 的注释写着「driven on a virtual clock so no real time
passes」，测试里的等待也确实全是虚拟的——被测的 `CallLimiter` 一个真定时器都不碰，
所有 sleep 都走注入的 `timers.sleep`。可这个文件单跑 1408ms，10 个用例、33 个断言，
没有网络没有文件系统。整个套件 372 个文件里绝大多数是 50–150ms。

## 原因

虚拟时钟自己是拿 `setTimeout(r, 0)` 推进的：

```ts
settle: async () => {
  for (let i = 0; i < 200; i++) await new Promise<void>((r) => setTimeout(r, 0));
}
```

`setTimeout(…, 0)` 不是 0：宿主把它钳到最小间隔（bun/JSC 上约 1ms），200 个空转就是
200 毫秒真实时间。7 个用例调 `settle()`，1.4 秒的账就是这么记的。`pump()` 每处理一个
事件也 await 一次同样的东西，再添一笔。

时钟越是「什么都不做」，这笔账越显眼：它跟被测代码的复杂度无关，只跟空转次数有关，
所以看 per-test 计时看不出来（bun 不给这个量级的用例打时间），看火焰图也只看到一片
定时器。

## 解法

被测代码不碰真定时器时，推进虚拟时钟用微任务就够了——`Promise.resolve()` 排空微任务
队列，足以让每个被 resume 的续体跑起来，而且不要钱：

```ts
const tick = (): Promise<void> => Promise.resolve();
```

`pump()` 和 `settle()` 都换成 `await tick()`。换完 1408ms → 130ms，用例数和断言数不变。
空转不要钱之后 `settle` 的 200 轮可以放到 2000 轮，反而更稳。

前提是**被测代码自己没有真定时器**。它要是有一个 `setTimeout` 在别处推进状态，微任务
永远等不到它，测试会挂在那儿而不是变快；那种情况得让那个定时器也变成注入的。

同一个虚拟时钟在 watchdog 和 prep 的测试里也有副本，同样的账，只是空转次数少所以没
排进最慢的五个。
