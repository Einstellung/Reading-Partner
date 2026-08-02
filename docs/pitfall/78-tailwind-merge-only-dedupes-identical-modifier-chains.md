# tailwind-merge 只在修饰符链完全相同时去重，剩下的按特异性决胜

## 现象

`Button` 的 `ghost` 变体里写了 `can-hover:enabled:hover:bg-accent`。调用点想换个悬停底色，传 `className="can-hover:hover:bg-[#f0eefb]"`，`cn()` 照常跑，结果悬停仍然是 `--accent` 的灰。

## 原因

`cn()` 是 `twMerge(clsx(...))`。tailwind-merge 判两个 class 冲突要求"同一个属性组 **且** 修饰符串一模一样"。`can-hover:enabled:hover` 和 `can-hover:hover` 不是同一个串，于是两条都留下来，交给 CSS 决胜。

编译出来是 `&:enabled:hover`（特异性 0,3,0）对 `&:hover`（0,2,0），变体那条赢。调用点写得再靠后也没用——层级和顺序在这里都不参与，特异性先决。

## 解法

两条路，都行：

- 覆盖时把修饰符链写全，和变体里的一模一样（`can-hover:enabled:hover:bg-[...]`）。
- 变体本身不加会拉高特异性的修饰符。`ghost` 现在就是 `can-hover:hover:bg-accent`，没有 `enabled:`，正因为它经常被换底色。会被禁用的变体（`default` / `outline` / `secondary`…）保留 `enabled:`，它们的悬停底色没人覆盖。

同族的坑：`Separator` 的方向规则写成 `data-[orientation=vertical]:h-full`，调用点传 `h-5` 同样输——`.x[data-orientation="vertical"]` 比 `.h-5` 特异。要覆盖就得写 `data-[orientation=vertical]:h-5`。
