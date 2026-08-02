# shadcn/ui 迁移

> 本文记录 UI 组件迁到 shadcn/ui 的共识。现状按 2026-08-01 的代码查证（`dab38fa` 之后）。
>
> 落地状态（2026-08-02）：第一、二版落地。
>
> 一：preflight、token 映射、Button / Input / Textarea / Label / Switch / Separator 六个原语，以及 `BTN` / `BTN_PRIMARY` / `BTN_SM` / `BTN_SM_DANGER` / `FIELD` / `INPUT` 全部调用点。
>
> 二：Toast 换 Radix Toast，`DeleteThreadButton` 换 AlertDialog，浮层安全区那层（`ui/overlay.tsx` + `overlay-safe`）和浮层层级登记（`common/overlay-layer.ts`）立起来。三到五版未开始。

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

Portal 与安全区。Radix 的浮层挂到 `body` 底下，不在 shell 那个带 `p-safe` 的容器里，拿不到它的内边距。这和坑 74 同族。第二版把规矩立起来了，做法见「浮层的规矩」。

`@layer` 顺序。项目是拆开 import 的（`theme.css` 和 `utilities.css` 分别引），Tailwind 不会替你排层。不显式写 `@layer theme, base, components, utilities;`，`@layer base` 会排到 utilities 之后，反过来压过每一个 utility class。层级顺序在级联里排在特异性之前。改动 `styles.css` 之后用 `grep '@layer' dist/assets/index-*.css` 确认首次出现顺序。

`HIT_44` 保持定尺寸居中的写法。引 preflight 之后这条约束仍然成立：只要按钮自己声明了 padding 或 border，伪元素的包含块（padding box）就会变，基于 `inset` 的算法还是会偏。

sanitize 仍是安全边界。速读正文是第三方 HTML，任何组件替换都不得往里重新引入属性。

## 接进来的方式

`components.json` 在仓库根，`@/` 指向 `src/`（`tsconfig.json` 的 `paths` 和 `vite.config.ts` 的 `resolve.alias` 各一份）。别名：`ui` → `@/ui/components/ui`、`utils` → `@/ui/components/lib/utils`。`bunx shadcn@latest add <component>` 直接写进 `src/ui/components/ui/`。

这两个目录都在 `ui/components` 里面，`tests/layering.test.ts` 把更深一层折叠进上一级，不用登记新的 LAYER 键。那个测试原来只认相对路径，`@/` 会绕过全部规则，所以顺手教会了它解析 `@/`。

应用代码仍然用相对路径 import，`@/` 只留给 shadcn 生成的文件。

依赖：`class-variance-authority`、`clsx`、`tailwind-merge`、`@radix-ui/react-slot`、`@radix-ui/react-label`、`@radix-ui/react-separator`、`@radix-ui/react-switch`，第二版加 `radix-ui` 和 `tw-animate-css`。没装 `lucide-react`（图标用项目自己的 `common/icons.tsx`）；以后 add 一个带图标的组件时会要它。

`radix-ui` 是伞包，现在的 shadcn 生成的就是 `import { AlertDialog } from "radix-ui"`，不再是单包。它 `sideEffects: false`，rollup 只把用到的那个打进去：第二版整套 Toast + AlertDialog 只让产物 JS 涨 55 KB（未压缩），产物里 grep 不到 Accordion / NavigationMenu / Menubar。第一版的单包留着不动，`button.tsx` 仍从 `@radix-ui/react-slot` 进。

`tw-animate-css` 不带 layer 引（`@import "tw-animate-css";`）：它自己有 `@theme` 和 `@utility`，套一层 layer 会把它们废掉。引完确认产物首次出现的层序仍是 properties → theme → base → components → utilities。

`bunx shadcn@latest add` 会顺手覆盖 `button.tsx`。第一版那份变体表是手写的，add 之后 `git checkout src/ui/components/ui/button.tsx` 找回来。

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
| `--destructive-hover` | `#991b1b` | 第二版加，`--primary-hover` 同理（实心红悬停变深） |
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

变体：`default`（实心紫，带透明边框——它要和 `outline` 并排且不能矮 1px）、`cta`（实心紫、无边框、字重 medium，info 的样子）、`outline`（白底描边，`BTN` 那 17 处）、`subtle`（透明底描边、灰字，info 的 chip）、`secondary`（紫底 chip）、`destructive-outline`（红字描边，`BTN_SM_DANGER`）、`destructive`（实心红，第二版加，AlertDialog 的 action）、`ghost`（图标按钮和阅读区顶栏）、`link`（无框无底，颜色留给调用点）。

尺寸：`default`（`text-sm px-3 py-1.5 rounded-md`）、`sm`（`text-xs px-2 py-1`）、`xs`（阅读侧面板的 11px）、`chip`（info 的 13px `rounded-lg`）、`lg`（info 的 14px CTA）、`icon`（`h-8 w-8`，调用点用 `h-6`/`h-7`/`h-9` 覆盖）、`link`（`p-0` + `HIT_44`）。

44px 写在尺寸里：会随内容长高的尺寸都以 `coarse:min-h-[44px]` 结尾，定尺寸的 `icon` 是 `coarse:h-11 coarse:w-11`，`link` 用 `HIT_44` 的居中伪元素（句子里的链接长不了）。调用点不再各自补。

hover 底色统一在 `can-hover:` 后面，避免触摸上点一下就卡住 hover 态。覆盖变体的 hover 底色要写一模一样的修饰符链，见坑 78。

## 浮层的规矩

第三、四版的每个浮层照这一节抄。两件事都由 `src/ui/components/ui/overlay.tsx` 一处提供，`ui/` 下的每个 content 组件都要做。

**安全区**。`ui/overlay.tsx` 导出 `OVERLAY_SAFE`，content 组件用 `cn()` 把对应那条拼进自己的 className：

```tsx
className={cn(OVERLAY_SAFE.centered, "fixed top-[50%] left-[50%] ...", className)}
```

- `centered`（Dialog / AlertDialog）= `overlay-safe` 这个 `@utility`，在 `styles.css` 里定义，同时管 `max-width`、`max-height` 和 `overflow-y: auto`。居中的盒子只能缩不能挪，所以每根轴夹的是两侧 inset 里较大的那个，另有 4 个 spacing 单位的槽宽兜底。
- `bottom`（toast viewport）= `bottom-safe-6`。贴边的浮层只需要它贴的那根轴，横向由自己的 `max-w` 管。
- 锚定型（第三版的 DropdownMenu / Popover）这一版没做。它的碰撞是 Radix 自己算的，要给它 `collisionPadding`，而 JS 读不到 `env()`；落这一版时在这里加 `anchored` 并写清楚怎么把 inset 送进去。

必须用 `cn()` 而不是拼字符串：`max-width` 只能有一条。shadcn 生成的 AlertDialogContent 自带 `max-w-[calc(100%-2rem)]` 和 `sm:max-w-lg`，和 `overlay-safe` 特异性相同，谁赢取决于 Tailwind 把自定义 utility 排在哪里。改成 `w-full` / `sm:w-[32rem]`，`max-width` 归 `overlay-safe` 独占。

**层级登记**。content 组件的 children 里放一个 `<OverlayLayer />`，它不渲染 DOM，只在挂载期间给 `common/overlay-layer.ts` 的计数加一。放在 children 里而不是组件顶层：AlertDialogContent 一直在树上，真正随开关挂载卸载的是 Portal 里那棵。

计数是给应用自己那批「点外面就关」的浮层看的（`CallBubble`、`AnnotationPopup`，第三版还有 `MoreMenu`、`SourcesPage` 的 HealthDot、`PenToolbar`）。它们用 `ref.contains(e.target)` 判断，而 Portal 出去的子树永远不在那个 ref 里，于是落在对话框按钮上的那一按被读成「按在外面」，气泡先关掉，按钮再也收不到 click。改成先问一句 `if (overlayLayerOpen()) return;`：有层开着的时候，任何一按都属于那一层。用计数不用 DOM 归属，是因为要挡住的不只是 content，还有背板和 popper 的包装节点。

## 第二版：Toast 与 AlertDialog

**Toast 选 Radix Toast，不是 Sonner。** 硬要求是调用点 API 不变、种类和自动消失语义不变、视觉不变。Sonner 自带 store、自带注进 `<head>` 的样式表、自带堆叠几何（默认折叠成一摞，每条用 transform 绝对定位），要还原现在这个「amber/red 描边盒子、竖排、gap-2」得逐条盖它的内部结构，而且 `useToasts` 的列表会和它的 store 变成两份状态。Radix Toast 无样式，DOM 是自己的，所以盒子、堆叠和 44px 关闭按钮都还是现在这套。

分工：列表还是 `common/Toast.tsx` 的 `useToasts`（`push` / `dismiss` 签名一个字没动），盒子和倒计时是 `ui/toast.tsx`。原来的 `window.setTimeout` 删掉，`duration` 交给 Radix。

Radix 带进来三件行为上的变化：倒计时在指针停在浮层上时暂停，在窗口失焦时也暂停（`window.addEventListener("blur")`），焦点回来才续；Escape 关掉整摞；向右滑可以划掉一条。前两条是好的——用户没看见的 toast 不该过期——但要知道它在：Tauri 里弹原生文件对话框会让窗口失焦，那期间的 toast 不会自己走。

**AlertDialog 替两步确认。** 原来是按一下变红「Confirm delete」、再按一下才删。换成 trigger + AlertDialog，语义等价（仍是一次明确确认），多了标题、说明和 Cancel，也多了背板。坑 67 那套 document 级 `pointerdown` 监听在 `DeleteThreadButton` 里整个删掉了：不再有任何东西挂在焦点上，Radix 自己管焦点陷阱。

**视觉变化清单**。除下面这些之外，23 个节区逐节点相同、逐像素相同（`home-cards` 里 60 个像素差是那个转圈动画的取帧，base 自己跟自己比也差，`opacity` 0.818 / 0.669 / 0.656）：

- toast 关闭按钮拿到 `cursor: pointer`，hover 变透明度移到 `can-hover:` 后面。
- 删除按钮从裸 `<button>` 换成 `Button variant="ghost" size="icon"`，带来 `display: flex → inline-flex`、`gap: normal → 6px`、图标 `flex-shrink: 1 → 0`、`cursor: pointer`，几何不变；hover 底色跟着第一版的规矩挪到 `can-hover:` 后面。
- toast 的 DOM 结构变了（Radix 加了一个 `role="region"` 的包装 div、一个 `<ol>`，每条从 `<div>` 变 `<li>`，另有一个只活 1 秒的朗读节点 portal 到 body），但两条 toast 的盒子位置、尺寸和每一条计算样式都逐字节相同。
- 确认从行内红药丸变成对话框，红色取 `--destructive`（`#b91c1c`），不再是 `red-600`。

**44px**（coarse 下）：toast 关闭 44×44，删除 trigger 44×44，Cancel 69.6×44，Delete 68.6×44。细指针下分别是 24×24 / 24×24 / 69.6×28 / 68.6×28，桌面密度没被撑大。全项目的触摸目标普查（143 个可点元素，36 个低于 44px）前后逐行相同。

**Radix 模态副作用**，开→关一轮实测（Chromium，鼠标与触摸各一遍）：`body` 上的 `pointer-events: none`、`data-scroll-locked`、`overflow: hidden`、`<head>` 里那个 `<style>`、兄弟节点的 `aria-hidden` / `data-aria-hidden` 全部干净撤销，`window.scrollY` 一格没动（9876 → 9876 → 9876），`padding-right` 补偿始终是 0（这个 app 的 body 本来就不滚）。唯一残留是 `body` 上留下一个空的 `style=""` 属性。阅读区的 `user-select`（坑 49）不受影响：Radix 只碰 body 和它自己的 portal 根。

单独验了最容易脏的那条路：删除本身会把整个通话关掉，宿主连着开着的对话框一起 unmount，对话框不是「关闭」而是「消失」。这一路同样干净——`pointer-events` 回 `auto`、滚动锁和注进去的 `<style>` 都没了，事后在页面中心做 `elementFromPoint` 命中的元素 `pointer-events: auto`。

**WebKit 上的 tap**：无头 WebKit 跑不起来（本机 webkit-2215 缺 `libavif16`，装不了），只在 Chromium 的 `hasTouch` 上下文里验了——开对话框一按、Delete 一按就生效，不需要按两次。真机上还没验的是 iOS 的幽灵点击：从 tap 打开一个正好落在手指下方的浮层，touchend 合成的 click 可能直接打到刚挂上来的按钮。这里的对话框居中、trigger 在气泡右上角，两者不重叠，但第四版的全屏 Dialog 要留意。

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

测安全区：同样的复制手法，把副本 CSS 里每个 `env(safe-area-inset-*)` 换成 `var(--sa-*, 0px)`，驱动脚本往 `:root` 上设这四个自定义属性就能给页面任意一组 inset。桌面浏览器的 `env()` 恒为 0，没有别的办法。改完等 400ms 再量：开场动画没跑完时 `getComputedStyle` 给的是过程值（150ms 时量到的 `max-height` 是 788.465px，实际是 782px）。

要驱动的交互（浮层开合、确认、点外面）单独一个脚本，不走静态 dump：Portal 出去的节点不在任何 `[data-screen]` 里，逐节点 dump 看不见它们。探针里那个宿主组件要真的会卸载——`onClose` 只记一笔数不卸载的话，两种实现都能把删除跑通，问题就测不出来。想证明某个保护确实必要，就把它拆掉再单独构建一份产物（`--outDir dist-probe-noguard`）跑同一段脚本，对照两边的计数。

纯浏览器里能起来的界面只有 Vestibule / Library / Settings（Tauri 存储调用会报错但 UI 正常渲染），其余全靠探针页。

## 未决

第四版的 Dialog 是否连 `SettingsView` 一起换——它是全屏页而不是对话框，用 Dialog 包可能是削足适履。
