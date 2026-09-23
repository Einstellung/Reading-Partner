# 想还原行高要写 `leading-normal`，`leading-[normal]` 是另一个值

## 现象

shadcn 的文本原语自带 `leading-none`（`DialogTitle` 是 `text-lg leading-none font-semibold`）。原来那行没写过行高，为了还原它写了 `leading-[normal]`，标题行高从 33px 变成 30px，下面所有东西上移 3px。

## 原因

`leading-[normal]` 编出来的是 `line-height: normal`，即字体自己的建议行距（22px 的 system-ui 上大约 26px）。而这个项目里"没写过行高"不等于 `normal`——preflight 给 `html` 设了 `line-height: 1.5`，继承下来是 33px。

## 解法

写 `leading-normal`。Tailwind v4 的 `--leading-normal` 就是 `1.5`，和继承来的那个值完全相同。

要压掉的是默认类而不是加一条：这三个类都在 utilities 层、特异性相同，只有 `cn()` 去重才真的把 `leading-none` 拿掉（`asChild` 的拼接不行，见坑 87）。
