# shadcn 生成的 Select 是 item-aligned，浮层安全区那套对它完全不生效

## 现象

`SelectContent` 照 `docs/30` 的「浮层的规矩」拼上 `OVERLAY_SAFE.anchored` 和 `collisionPadding={useOverlaySafePadding()}`，不报错，也没有任何效果：横屏 50px 侧边 inset 下列表照样压在 inset 里。

## 原因

`bunx shadcn@latest add select` 生成的 `SelectContent` 默认 `position="item-aligned"`。那是 Radix Select 的另一套定位（把选中项对齐到 trigger 上，像 macOS 的 popup），根本不是 popper：

- 不发布 `--radix-popper-available-width` / `--radix-popper-available-height`，`OVERLAY_SAFE.anchored` 里那两个变量解析为空，`max-width` 回到 `none`、`max-height` 回到 `100%`。
- `collisionPadding` 是 popper 的属性，item-aligned 收都不收，它用自己的常量边距。
- 不写 `data-side`。

实测（视口 900×800，trigger 贴右缘，`-safe` 改造产物给三组 inset）：

| position | maxW / maxH | 无 inset 的右侧余量 | 横屏 50/50 的右侧余量 |
|---|---|---|---|
| `item-aligned`（生成的默认） | `none` / `100%` | 7px | 47px |
| `popper` | 884px / 742px | 8px | 50px |

47px 那格还是因为外壳的 `p-safe` 把 trigger 本身推进来了，列表只是跟着 trigger 走；padding 一格没起作用。

## 解法

`SelectContent` 里写死 `position="popper"`。`tests/ui/components/primitive-contract.test.ts` 盯着这一条，因为再 `add` 一次就会换回默认那份（坑 81）。

popper 模式下 `--radix-select-content-available-*` 只是 `--radix-popper-available-*` 的别名，所以照旧用 popper 级的那两个变量，一串对每个 popper 浮层都成立。
