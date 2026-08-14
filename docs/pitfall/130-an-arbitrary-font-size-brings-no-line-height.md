# Tailwind 的任意值字号不带行高，`text-sm` 这类带

## 现象

`text-sm` 换成 `text-[calc(0.875rem*var(--chat-scale,1))]` 之后字号对了，行距变松了一档：从 20px 退回 preflight 的 1.5。

## 原因

两条规则编出来不一样（生产构建里的实际输出）：

```css
.text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}
.text-\[calc\(0\.875rem\*var\(--chat-scale\,1\)\)\]{font-size:calc(.875rem * var(--chat-scale,1))}
```

命名字号在 theme 里成对存了 `--text-sm` 和 `--text-sm--line-height`，utility 把两条都写出来。任意值没有这个配对，只出 `font-size`，行高就落回继承来的那个。

## 解法

任意值字号自己补一条行高。跟着字号缩放的场景要写无单位的（`leading-[1.43]`）：`leading-5` 是 `1.25rem`，按根字号算，字号变大它不动，行距会越缩越紧。
