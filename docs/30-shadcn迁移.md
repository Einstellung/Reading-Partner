# shadcn/ui 迁移

> 本文记录 UI 组件迁到 shadcn/ui 的共识。现状按 2026-08-01 的代码查证（`dab38fa` 之后）。
>
> 落地状态（2026-08-01）：第一步（引 preflight）在做，未合并。其余未开始。

---

## 为什么迁

按钮样式散成 68 组。紫色主按钮三套并存：`#6c4fd0` / `rounded-md` / `text-sm` / `px-3 py-1.5`（设置与对话框）、`#6d5ae0` / `rounded-lg` / `text-[14px]` / `px-4 py-2`（info 大 CTA）、`#6d5ae0` / `rounded-lg` / `text-[13px]` / `px-3.5 py-1.5`（InfoCards）。次级按钮两套。图标按钮约 20 个各写各的，`coarse:h-11 coarse:w-11` 在每个调用点重复。

更贵的是后面要加的东西：dialog、dropdown、select、tooltip、popover、tabs。成本在焦点陷阱、`aria`、键盘导航、roving tabindex，手写要么漏要么慢。Radix 那层就是干这个的。分界线在这里，不在按钮。

## 原则

迁标准原语，不迁按实测结论调过的触摸交互。

一版一验。每版发 TestFlight，在真机上对比再进下一版。

视觉统一是目的，省代码不是。迁移过程中视觉不应该有变化，除非某处本来就是不一致或错的，那种要明确列出来。

不引 preflight 这个决定已经推翻（见下）。

## 不迁的

阅读区的标注层、笔工具色板（`PenToolbar`）、`CallBubble`、`MicButton` 的按住录音、`TraceList` 的滑动删除、`ReadingPipCard`。

理由分两类：一类没有对应的 Radix 原语（录音手势、滑动删除、锚定在划线上的气泡）；一类已经按实测结论调过并记在坑里（浮层定位与夹取见 `src/ui/components/common/panel-position.ts`，软键盘避让见 `useKeyboardInset`，触摸上的 tap 行为见坑 67）。换过去只有损失。

现有浮层留着不动，新浮层用 Radix，两者共存。

## 分版

一、基座。引 Tailwind 完整 preflight，定 token 映射，上 Button、Input、Textarea、Label、Switch、Separator。全是叶子，逐项肉眼对比即可验收。

二、反馈类。`Toast` 换掉自写的那个，`DeleteThreadButton` 的两步确认换 AlertDialog。

三、菜单。`MoreMenu` 换 DropdownMenu，速读的 Filtered 折叠换 Collapsible。Popover 只用在新地方。

四、对话框。`SettingsView` 的全屏和 `SlidesDialog` 换 Dialog。风险最高，单独发一版：它同时碰到安全区、软键盘和滚动锁。

五、收尾。Select、Tabs、Badge 按需要上。删掉过渡期留下的常量。

## 必须守住的

44px。shadcn 的按钮默认高 36/40px，触摸下不够。`coarse:` 变体要加到迁过去的组件上，不能因为换库丢掉这条线。`can-hover:` 同理——hover 才出现的控件在触摸上必须常驻可见。

Portal 与安全区。Radix 的浮层挂到 `body` 底下，不在 shell 那个带 `p-safe` 的容器里，拿不到它的内边距。这和坑 74 同族。第一版就要把规矩定死：包一层统一的 content 组件，安全区在那里加一次，后面每个浮层都从它出。

`@layer` 顺序。项目是拆开 import 的（`theme.css` 和 `utilities.css` 分别引），Tailwind 不会替你排层。不显式写 `@layer theme, base, components, utilities;`，`@layer base` 会排到 utilities 之后，反过来压过每一个 utility class。层级顺序在级联里排在特异性之前。改动 `styles.css` 之后用 `grep '@layer' dist/assets/index-*.css` 确认首次出现顺序。

`HIT_44` 保持定尺寸居中的写法。引 preflight 之后这条约束仍然成立：只要按钮自己声明了 padding 或 border，伪元素的包含块（padding box）就会变，基于 `inset` 的算法还是会偏。

sanitize 仍是安全边界。速读正文是第三方 HTML，任何组件替换都不得往里重新引入属性。

## token 映射

不全项目换配色。定一组 CSS 变量映射到现有的颜色值，放 `styles.css`，shadcn 的组件直接用现在的配色，以后 `npx shadcn add` 进来的也对得上。

要映的至少有：`--background` / `--foreground` / `--primary` / `--primary-foreground` / `--border` / `--input` / `--ring` / `--muted` / `--muted-foreground` / `--accent` / `--destructive` / `--radius`。

紫色主按钮三套并存的问题在这一步收敛成一个 `--primary`。选哪一档要单独定，不要顺手取平均。

## 验证方法

比截图比对准的做法：`bun run build` 之后 `cd dist && python3 -m http.server`，把旧 CSS 拷成 `dist/before.css`，页面里切 `link.href`，同一 DOM 上前后各取一次 `getComputedStyle` 直接 diff。纯 CSS 改动不必重建 app。

测 `coarse:` 变体：把产物里的 `@media (pointer:coarse)` 替换成 `@media all` 存成另一份 CSS 切过去量。

纯浏览器里能起来的界面只有 Vestibule / Library / Settings（Tauri 存储调用会报错但 UI 正常渲染）。Briefing、阅读页、聊天需要数据，进不去，用从源码抠 className 生成的静态渲染页覆盖。

## 引 preflight 的代价

已知会变的：描边按钮今天静息态是浏览器的 `buttonface` 灰、悬停变浅灰，跟作者写的 `hover:bg-[#f4f4f4]` 意图相反，preflight 一上自动修好；12 个文本输入框靠 UA 白底，要补 `bg-white`；聊天输入框今天是 monospace（textarea 的 UA 字体）；`FigureCard` 的 `em` 字号今天相对 UA 的 13.333px 算，之后跟随正文，和旁边视觉一样的 chip 自动一致。

风险面两处：阅读区页面是 blob `<img>` 光栅，preflight 的 `img { display: block; max-width: 100% }` 直接命中；速读正文是第三方 HTML，preflight 清掉 `p`、`table`、`code`、`blockquote` 等默认样式后会塌成没有段间距的一片，`proseCss.ts` 要补成完整的 prose 样式表。

坑 43（tap highlight）引 preflight 后自动消失。坑 49（阅读区的 `user-select`）不受影响，手工处理仍然必要——preflight 不管 `user-select`。

## 未决

`--primary` 取哪一档紫。

第四版的 Dialog 是否连 `SettingsView` 一起换——它是全屏页而不是对话框，用 Dialog 包可能是削足适履。
