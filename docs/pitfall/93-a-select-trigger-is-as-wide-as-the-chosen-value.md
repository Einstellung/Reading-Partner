# 换掉 `<select>` 之后字段宽度开始跟着选中值变

## 现象

设置页的 Thinking 从 `<select>` 换成 Radix Select，字段从 97px 变成 66.6px，而且选 Medium 会再变宽——原来无论选哪一项都是 97px。

## 原因

原生 `<select>` 的固有宽度是所有 `<option>` 里最宽的那个，和当前值无关。Radix 的 trigger 是一个只装着选中项文本的 `<button>`，固有宽度就是那一行字。字段在 `flex flex-wrap` 的行里被内容定宽，于是每换一次值宽度就跳一次。

## 解法

在 trigger 里把宽度占住：所有选项文本都放进同一个 grid 单元格，零高、`invisible`，列宽取它们的最大值。

```tsx
<span className="grid min-w-0 flex-1 text-left">
  <span className="col-start-1 row-start-1 truncate">
    <SelectValue placeholder={placeholder} />
  </span>
  {choices.map((c) => (
    <span key={c.value} aria-hidden className="col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap invisible">
      {c.label}
    </span>
  ))}
</span>
```

`h-0` 让它们不参与行高，`invisible` 让它们不参与命中测试。换算字符数去猜宽度不行——中英日混排的选项列表里字符数和宽度没关系。

改完 Thinking 是 100.6px（原生 97px，差的是箭头区宽度不同），并且不再随值变化；Language 那个撑满卡片的字段前后都是 524.5px。
