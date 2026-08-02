# shadcn/ui 迁移

> 本文记录 UI 组件迁到 shadcn/ui 的共识。现状按 2026-08-01 的代码查证（`dab38fa` 之后）。
>
> 落地状态（2026-08-02）：第一版全部落地。preflight、token 映射、Button / Input / Textarea / Label / Switch / Separator 六个原语，以及 `BTN` / `BTN_PRIMARY` / `BTN_SM` / `BTN_SM_DANGER` / `FIELD` / `INPUT` 全部调用点。二到五版未开始。

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

## 接进来的方式

`components.json` 在仓库根，`@/` 指向 `src/`（`tsconfig.json` 的 `paths` 和 `vite.config.ts` 的 `resolve.alias` 各一份）。别名：`ui` → `@/ui/components/ui`、`utils` → `@/ui/components/lib/utils`。`bunx shadcn@latest add <component>` 直接写进 `src/ui/components/ui/`。

这两个目录都在 `ui/components` 里面，`tests/layering.test.ts` 把更深一层折叠进上一级，不用登记新的 LAYER 键。那个测试原来只认相对路径，`@/` 会绕过全部规则，所以顺手教会了它解析 `@/`。

应用代码仍然用相对路径 import，`@/` 只留给 shadcn 生成的文件。

依赖：`class-variance-authority`、`clsx`、`tailwind-merge`、`@radix-ui/react-slot`、`@radix-ui/react-label`、`@radix-ui/react-separator`、`@radix-ui/react-switch`。没装 `lucide-react`（图标用项目自己的 `common/icons.tsx`）；以后 add 一个带图标的组件时会要它。也没装 `tw-animate-css`，第二版的 Toast / AlertDialog 会要。

## token 映射

不全项目换配色。一组 CSS 变量映射到现有的颜色值，放 `styles.css` 的 `@layer base` 里，`@theme inline` 把它们接到 Tailwind 的 `--color-*`。取值全部来自 `src/` 里已经在用的十六进制：

| token | 值 | 原来在哪 |
|---|---|---|
| `--background` / `--card` / `--popover` | `#ffffff` | `bg-white` |
| `--foreground` / `--card-foreground` / `--popover-foreground` | `#1b1b1b` | `body { color }` |
| `--primary` | `#6c4fd0` | `BTN_PRIMARY`，2026-08-02 定案 |
| `--primary-foreground` | `#ffffff` | 同上 |
| `--primary-hover` | `#5a3fbf` | 同上 |
| `--secondary` | `#efecfb` | info / 阅读侧的紫底 chip |
| `--secondary-foreground` | `#4a3a9e` | 同上 |
| `--secondary-border` | `#c9c2e8` | 同上 |
| `--secondary-hover` | `#e7e3f7` | 同上 |
| `--muted` / `--accent` | `#f0f0f0` | `BTN` 的 hover |
| `--muted-foreground` | `#555555` | info chip 的字色 |
| `--accent-foreground` | `#1b1b1b` | 正文色 |
| `--destructive` | `#b91c1c` | `BTN_SM_DANGER` |
| `--destructive-foreground` | `#ffffff` | — |
| `--destructive-border` | `#f0c8c8` | `BTN_SM_DANGER` |
| `--border` / `--input` | `#dcdcdc` | 到处 |
| `--ring` | `#6c4fd0` | 定义了但这一版没用（现在没有一处自定义 focus 环，加上去就是视觉变化） |
| `--radius` | `0.5rem` | `rounded-lg`；`--radius-sm/md/lg/xl` 由它算出来，数值和 Tailwind 默认完全相同 |

`--muted` 和 `--accent` 同值，shadcn 自己的默认主题也是这样。`--primary-hover` 是加出来的：shadcn 用 `hover:bg-primary/90`，在白底上是变浅，而这里每个实心按钮悬停都变深。紫底 chip 占的是 `--secondary` 而不是 `--accent`，`--accent` 保持 shadcn 的语义（ghost 控件的悬停底色），以后 `shadcn add dropdown-menu` 进来的 `focus:bg-accent` 才是对的。

收敛了两处：

- 三套紫合成一个 `--primary` = `#6c4fd0`。`#6d5ae0`（info 大 CTA、InfoCards CTA、SourcesPage 开关和输入框聚焦边、几处 `text-[#6d5ae0]`）全部改掉，配套的 hover `#5d4bd0` → `#5a3fbf`。
- 两套 hover 灰合成一个 `--muted` = `#f0f0f0`，`#f4f4f4`（info chip）不再出现。

红色没动：`#b91c1c`（`BTN_SM_DANGER`）、`#c0392b`（info）、`red-600`（删除确认、划删）各自留着。

## 引 preflight 的代价

已知会变的：描边按钮今天静息态是浏览器的 `buttonface` 灰、悬停变浅灰，跟作者写的 `hover:bg-[#f4f4f4]` 意图相反，preflight 一上自动修好；12 个文本输入框靠 UA 白底，要补 `bg-white`；聊天输入框今天是 monospace（textarea 的 UA 字体）；`FigureCard` 的 `em` 字号今天相对 UA 的 13.333px 算，之后跟随正文，和旁边视觉一样的 chip 自动一致。

风险面两处，都已实测：

阅读区安全。页面光栅的 `width`/`height` 是引擎写在行内的，`max-width: 100%` 解析到同一个包含块因此不夹取；`display: inline → block` 反而消掉了每个页容器 5px 的行盒溢出。demo.pdf 在 fit / 两级放大 / fit-width / 跳页 / 选中标注五个状态下截图逐字节相同，`scrollHeight` 每一档都不变。只有翻页模式差 1px，成因见坑 76。

速读正文按预期塌了，`proseCss.ts` 已补成完整 prose 样式表（标题到 h6、列表标记、dl、hr、pre、table 外边距、caption、kbd/samp）。

坑 43（tap highlight）引 preflight 后自动消失。坑 49（阅读区的 `user-select`）不受影响，手工处理仍然必要——preflight 不管 `user-select`。

## Button 的变体表

变体只管颜色和边框，尺寸只管几何，两者组合。表是从现有 122 个按钮归类出来的，不是 shadcn 的默认。

变体：`default`（实心紫，带透明边框——它要和 `outline` 并排且不能矮 1px）、`cta`（实心紫、无边框、字重 medium，info 的样子）、`outline`（白底描边，`BTN` 那 17 处）、`subtle`（透明底描边、灰字，info 的 chip）、`secondary`（紫底 chip）、`destructive-outline`（红字描边，`BTN_SM_DANGER`）、`ghost`（图标按钮和阅读区顶栏）、`link`（无框无底，颜色留给调用点）。

尺寸：`default`（`text-sm px-3 py-1.5 rounded-md`）、`sm`（`text-xs px-2 py-1`）、`xs`（阅读侧面板的 11px）、`chip`（info 的 13px `rounded-lg`）、`lg`（info 的 14px CTA）、`icon`（`h-8 w-8`，调用点用 `h-6`/`h-7`/`h-9` 覆盖）、`link`（`p-0` + `HIT_44`）。

44px 写在尺寸里：会随内容长高的尺寸都以 `coarse:min-h-[44px]` 结尾，定尺寸的 `icon` 是 `coarse:h-11 coarse:w-11`，`link` 用 `HIT_44` 的居中伪元素（句子里的链接长不了）。调用点不再各自补。

hover 底色统一在 `can-hover:` 后面，避免触摸上点一下就卡住 hover 态。覆盖变体的 hover 底色要写一模一样的修饰符链，见坑 78。

## 第一版的视觉变化

逐屏对比的做法在下一节。除下面这些之外，22 个屏的每个节点的几何和计算样式逐字节相同。

有意的：

- 紫色收敛（见上）。受影响：vestibule、home cards、InfoCards、SourcesPage、briefing / article / saved 的来源标签。settings 一个像素没动，那里本来就是 `#6c4fd0`。
- `LibraryScreen` 的两个输入框从 16px 变 14px。它们是全项目唯一没写字号的字段，靠 UA 继承到 16px，和别处 `text-sm` 的字段不一致；一起补上了 `min-w-0`（长标题原来会把行撑宽）。行高 42 → 38，下面的列表整体上移 4px。
- `SourcesPage` 的开关圆点回到正确位置。原来的手写 toggle 把圆点画在轨道外面，见坑 77。
- info 侧的按钮拿到 `cursor: pointer`。它们原来没写，鼠标停上去是箭头。
- 触摸目标：阅读侧面板的 11px 按钮（11 处）、纯文字链（8 处）、InfoCards 的 CTA（3 处）、CallView 的 Classroom、`ArticleView` 的 Keep 从 28–36px 提到 44px。探针里可点元素低于 44px 的从 52 个降到 33 个。

无视觉后果但会出现在样式 diff 里：`display: block → flex`（基类是 `inline-flex`，单子元素时几何不变）、`gap: normal → 6px`（同上）、`[&_svg]:shrink-0`、`size="link"` 带来的 `position: relative`。

剩下的 33 个低于 44px 的可点元素，都不在这一版的范围里：正文和聊天里的行内链接（`<a>`，加了 padding 就断行）、聊天输入区（`docs/30` 不迁）、标注气泡（不迁）、设置页的原生复选框（Checkbox 不在这六个原语里）、库和 prep 的列表行（行高由内容定）。设置页所有真正的文本字段在 `coarse:` 下都是 16px。

## 验证方法

比截图比对准的做法：`bun run build` 之后 `cd dist && python3 -m http.server`，把旧 CSS 拷成 `dist/before.css`，页面里切 `link.href`，同一 DOM 上前后各取一次 `getComputedStyle` 直接 diff。纯 CSS 改动不必重建 app。

改组件就不够了，要两份产物。第一版是这么做的：`origin/main` 的源码单独导一份到 `/tmp/base-app`，两边各加同一个探针页（挂真组件 + 固定 fixture，覆盖浏览器进不去的 22 个屏），各自 `vite build`，两个静态服务器，playwright 驱动 Chromium 按「节区内的 DOM 序号 + 标签名」逐节点 dump 几何和计算样式再 diff，同时对每个节区截图做逐像素对比。

探针页里 `position: fixed` 的东西（`SettingsView`、`Toast`、`AnnotationPopup`）会盖满整页，每个节区截的都是同一张图；给节区加 `transform: translate(0)` 让它成为 fixed 的包含块就好了。

测 `coarse:` 变体：整份 dist 复制一遍，在副本的 CSS 里把 `@media (pointer:coarse)` 换成 `@media all`，另起一个端口。不能只在 HTML 里加一个改造过的 `<link>`，原因见坑 79。

纯浏览器里能起来的界面只有 Vestibule / Library / Settings（Tauri 存储调用会报错但 UI 正常渲染），其余全靠探针页。

## 未决

第四版的 Dialog 是否连 `SettingsView` 一起换——它是全屏页而不是对话框，用 Dialog 包可能是削足适履。
