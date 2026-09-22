# TypeBox 的每个属性都是必填，模型交不出来就死循环

## 现象

手机上和 meals 对话，`propose_meals_plan` 在工具循环里反复失败，用户看着它一轮一轮重试：

```
Validation failed for tool propose_meals_plan:
  - days.0.breakfast.reheatOf: must be object
```

模型改成 `reheatOf: {}` 再来一次，换一句错：

```
  - days.0.breakfast.reheatOf: must have required properties reheatOf
```

两句之间来回跳，回合永远走不到 execute。

## 原因

`Type.Object({...})` 把每个属性都写进 `required`，没有别的写法——想要可选只能 `Type.Optional`。`mealSchema` 里 `reheatOf` 是个嵌套 `Type.Object`，而它只对 reheat 和 packed 有意义：cook、out、delivery 的那一餐模型手里没有东西可填，于是发 `null` 或 `{}`，两种都过不了校验。

校验器是 pi-ai 的 `validateToolCall`（`node_modules/@earendil-works/pi-ai/dist/utils/validation.js`），它对 `null` 有两条兜底，但都救不了这里：

- `normalizeOptionalNulls` 只删「不在 `required` 里」的那些 `null` 属性。必填的原样留下。
- `coercePrimitiveByType` 把 `null` 转成基本类型的零值（string 转 `""`、number 转 `0`、boolean 转 `false`）。object 和 array 不在里面。

所以必填的字符串和数字发 `null` 没事，必填的对象和数组发 `null` 就是 `must be object`；换成 `{}` 又轮到它内部的必填属性报 `must have required properties`。

漏掉不发同样是 `must have required properties`，这一条对所有类型成立，不分对象还是字符串。描述里写着「只在某种情况下给」「可以为空」的字段，模型本来就会漏掉。

## 解法

工具 schema 里只有每次调用都有值的字段留必填，其余一律 `Type.Optional`。判据是字段自己的描述：说了「哪种模式才有」「没有就留空」「要改才给」的，都是模型会漏掉或发 `null` 的。

`src/info/meals/tools.ts` 按这条过了一遍：一餐里除 `mode` 之外全可选（`reheatOf` 在内），一天的三餐也可选（调整只发变了的那几餐），`dishes`、`adjustment`、`breakfastLine`、`stores`、`dislikes`、`place`、`today`、`qty`、`note` 同样。

execute 早就容忍这些字段不在——缺得不对它会用模型能看懂的话拒绝一次（「一整周要七天」），这比校验器的死循环好：一次拒绝模型能改，校验失败它只会原样再试。

回归测试在 `tests/info/meals/tools.test.ts`，直接调 `validateToolCall` 走一遍真的校验，不走 execute 的后门。
