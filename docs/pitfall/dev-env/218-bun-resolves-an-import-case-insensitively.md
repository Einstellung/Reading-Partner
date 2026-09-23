# bun 按大小写不敏感解析 import，同目录下的 `orb.ts` 和 `Orb.tsx` 互相顶掉

## 现象

`src/ui/components/orb/` 下按 docs/45 写了 `orb.ts`（纯函数）和 `Orb.tsx`（渲染）。
测试 `import { ... } from ".../orb/orb"`，bun 报：

```
error: ENOENT reading ".../src/ui/components/orb/orb.tsx"
```

两个文件都在盘上，文件系统是 ext4（大小写敏感），报的却是一个不存在的
`orb.tsx`。

## 原因

两条叠在一起。

一，bun 的解析器扫目录时不区分大小写：`./orb` 匹配到了 `Orb.tsx`，然后按请求
的小写名去读，于是 ENOENT。最小复现（bun 1.3.11）：目录里放 `foo.ts` 和
`Foo.tsx`，`import "./x/foo"` 报 `ENOENT ... x/foo.tsx`。

二，扩展名优先级是 `.tsx` 在 `.ts` 之前。同目录 `bar.ts` 和 `bar.tsx`
（大小写相同）时，`import "./x/bar"` 拿到的是 `bar.tsx`。

所以只要同一目录里两个源文件的基名只差大小写，谁也 import 不到自己那一个。

## 解法

同目录内不要出现只差大小写的基名。orb 这一处保留 docs/45 指定的 `orb.ts` 和
`orb.test.ts`，把组件命名成 `VoiceOrb.tsx`（导出的组件本来就叫 `VoiceOrb`）。

`.tsx` 优先于 `.ts` 这条单独也要记着：想引 `x.ts` 而同目录有 `x.tsx` 时，不带
扩展名的 import 拿到的是后者。
