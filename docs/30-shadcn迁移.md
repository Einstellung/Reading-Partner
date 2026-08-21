# shadcn/ui 迁移

> 本文记录 UI 组件迁到 shadcn/ui 的共识。现状按 2026-08-01 的代码查证（`dab38fa` 之后）。
>
> 落地状态（2026-08-03）：五版全部落地，迁移完成。之后补了一次阅读区的配色收敛（见「阅读区的收敛」）和一次 ref 透传修复（见「ref 透传」）。
>
> 一：preflight、token 映射、Button / Input / Textarea / Label / Switch / Separator 六个原语，以及 `BTN` / `BTN_PRIMARY` / `BTN_SM` / `BTN_SM_DANGER` / `FIELD` / `INPUT` 全部调用点。
>
> 二：Toast 换 Radix Toast，`DeleteThreadButton` 换 AlertDialog，浮层安全区那层（`ui/overlay.tsx` + `overlay-safe`）和浮层层级登记（`base/overlay-layer.ts`）立起来。
>
> 三：`MoreMenu` 换 DropdownMenu，速读的 Filtered 折叠换 Collapsible，锚定型浮层的安全区补进 `ui/overlay.tsx`。Popover 没用上，没引。
>
> 四：`SlidesDialog` 换居中的 Dialog，`SettingsView` 换新的全屏 content 变体。
>
> 五：四个 `<select>` 换 Select，四个原生复选框换 Checkbox，紫底 chip 换 Badge，过渡期的常量清干净。Tabs / Tooltip 没引，理由见「没引的」。
>
> `src/ui/components/ui/` 五版之后一共 15 个文件：alert-dialog、badge、button、checkbox、collapsible、dialog、dropdown-menu、input、label、overlay、select、separator、switch、textarea、toast。之后设置页重组时加了 tabs，共 16 个（见「各版改了什么」）。

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

迁完之后这份清单没有变，最终还剩下什么、为什么留，见「最终还剩的手写控件」。

## 分版

一、基座。引 Tailwind 完整 preflight，定 token 映射，上 Button、Input、Textarea、Label、Switch、Separator。全是叶子，逐项肉眼对比即可验收。

二、反馈类。`Toast` 换掉自写的那个，`DeleteThreadButton` 的两步确认换 AlertDialog。

三、菜单。`MoreMenu` 换 DropdownMenu，速读的 Filtered 折叠换 Collapsible。Popover 只用在新地方。

四、对话框。`SettingsView` 的全屏和 `SlidesDialog` 换 Dialog。风险最高，单独发一版：它同时碰到安全区、软键盘和滚动锁。`SettingsView` 也换，走一个新的全屏 content 变体。

五、收尾。Select、Checkbox、Badge，删掉过渡期留下的常量，全项目触摸目标复核。

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

依赖：`class-variance-authority`、`clsx`、`tailwind-merge`、`@radix-ui/react-slot`、`@radix-ui/react-label`、`@radix-ui/react-separator`、`@radix-ui/react-switch`，第二版加 `radix-ui` 和 `tw-animate-css`。没装 `lucide-react`（图标用项目自己的 `base/icons.tsx`）：`shadcn add` 生成的 dialog / dropdown-menu / select / checkbox 都从它取图标，每次都要换成 `base/icons.tsx` 的，或者连那一段一起删掉。五版下来 npm 依赖一个没再加，Select / Checkbox / Badge 全在 `radix-ui` 伞包和 cva 里。整包体积（JS + CSS，未压缩）第四版 3451.6 KB → 第五版 3478.0 KB，涨的 26.4 KB 是 Select 那一套；CSS 66.0 → 66.6 KB。

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

第三版起的每个浮层照这一节抄。两件事都由 `src/ui/components/ui/overlay.tsx` 一处提供，`ui/` 下的每个 content 组件都要做。

**安全区**。`ui/overlay.tsx` 导出 `OVERLAY_SAFE`，content 组件用 `cn()` 把对应那条拼进自己的 className：

```tsx
className={cn(OVERLAY_SAFE.centered, "fixed top-[50%] left-[50%] ...", className)}
```

- `centered`（Dialog / AlertDialog）= `overlay-safe` 这个 `@utility`，在 `styles.css` 里定义，同时管 `max-width`、`max-height` 和 `overflow-y: auto`。居中的盒子只能缩不能挪，所以每根轴夹的是两侧 inset 里较大的那个，另有 4 个 spacing 单位的槽宽兜底。
- `bottom`（toast viewport）= `bottom-safe-6`。贴边的浮层只需要它贴的那根轴，横向由自己的 `max-w` 管。
- `anchored`（DropdownMenu，以后的 Popover / Select）分两半，两半都要。位置那半是 Radix 的：content 上传 `collisionPadding={useOverlaySafePadding()}`，每边取 max(inset, 8px)。JS 读不到 `env()`（坑 84），所以 inset 是从一个隐藏探针元素的计算 padding 量来的（`base/safe-area.ts` + `styles.css` 的 `safe-probe`），在挂载和 resize 时量。尺寸那半是 CSS 的：`max-w-(--radix-popper-available-width) max-h-(--radix-popper-available-height)`，这两个变量是 Radix 按同一份 collisionPadding 算出来的剩余空间，配 content 自带的 `overflow-y: auto`，把「比它能待的地方还大」变成盒子内部滚动。用 popper 级的变量而不是每个组件自己的别名，同一串对每个 popper 浮层都成立。

  锚定型不写 `overlay-safe`：那条夹的是居中盒，锚定盒是移动而不是收缩。也不写 `anchor-safe`：那个 `@utility` 是给自己算坐标的 `position: fixed` 浮层用的，Radix 的坐标写在 popper 包装节点的 transform 上，`left`/`top` 夹取碰不到它。

  能保证的上限是锚点本身：`limitShift()` 不让浮层脱离锚点，所以锚点贴在视口边缘时浮层只能退到锚点边缘（坑 85）。外壳的 `p-safe` 把锚点推进安全区，这条才成立。

- `fullscreen`（盖住整个 app 的页：`SettingsView`，第五版可能还有）= `pt-safe-10 pr-safe-6 pb-safe-10 pl-safe-6`，加在页面自己那根内容列上，不加在 content 盒上。content 盒是 `fixed inset-0 overflow-y-auto bg-background`，不夹取——它就是视口，`overlay-safe` 那套 `max-w` / `max-h` 对它没有意义，而它的底色必须铺到屏幕边缘，安全区只推内容。数值是原来写在 `SettingsView` 里那一组，搬进来一处，调用点不再各写各的。

  这个变体的 content 有两处和别人不一样，都是必须的。

  **不 Portal。** 手机壳的左缘返回手势拿 `transform` 平移整个界面，`position: fixed` 的子元素只有还在那棵子树里才跟着走；Portal 出去之后它既不动，也收不到挂在那个元素上的 capture 监听（坑 89）。渲染在原地，DOM 位置和换之前一样。实测：把壳平移 120px，旧版全屏页移 120、新版也移 120，居中那个 Portal 出去的移 0。

  **不渲染 `DialogOverlay`。** Radix 把 `RemoveScroll` 放在 Overlay 里而不是 Content 里（坑 88），所以不渲染 Overlay 就没有滚动锁——全屏页盖住整个视口、自带滚动容器，底下没有东西需要锁，少一把锁就少一批要还原的 `body` 状态。也没有东西需要调暗，页面本身不透明。`modal` 仍然是 `true`：要的是焦点陷阱、身后一切的 `aria-hidden`、外部指针关掉，和 Escape。

必须用 `cn()` 而不是拼字符串：`max-width` 只能有一条。shadcn 生成的 AlertDialogContent 自带 `max-w-[calc(100%-2rem)]` 和 `sm:max-w-lg`，和 `overlay-safe` 特异性相同，谁赢取决于 Tailwind 把自定义 utility 排在哪里。改成 `w-full` / `sm:w-[32rem]`，`max-width` 归 `overlay-safe` 独占。

`cn()` 也只到修饰符串一模一样为止（坑 78）。DialogContent 原来照 AlertDialog 留了一条 `sm:w-[32rem]`，调用点写的 `w-[min(35rem,100%)]` 没有 `sm:`，去重去不掉，640px 以上一直是 512px 宽——盒子从 560 缩到 512，节点 diff 里看得清清楚楚。带断点的默认尺寸整条删掉，宽度归调用点，`w-full` 只做兜底。

`asChild` 干脆不过 `cn()`，它把两串 className 拼起来（坑 87）。用 `asChild` 保住原来的标签时，样式写在包装组件上而不是子元素上。

**层级登记**。content 组件的 children 里放一个 `<OverlayLayer />`，它不渲染 DOM，只在挂载期间给 `base/overlay-layer.ts` 的计数加一。放在 children 里而不是组件顶层：AlertDialogContent 一直在树上，真正随开关挂载卸载的是 Portal 里那棵。

计数是给应用自己那批「点外面就关」的浮层看的（`CallBubble`、`AnnotationPopup`，第三版还有 `MoreMenu`、`SourcesPage` 的 HealthDot、`PenToolbar`）。它们用 `ref.contains(e.target)` 判断，而 Portal 出去的子树永远不在那个 ref 里，于是落在对话框按钮上的那一按被读成「按在外面」，气泡先关掉，按钮再也收不到 click。改成先问一句 `if (overlayLayerOpen()) return;`：有层开着的时候，任何一按都属于那一层。用计数不用 DOM 归属，是因为要挡住的不只是 content，还有背板和 popper 的包装节点。

**层级**。`ui/overlay.tsx` 的 `OVERLAY_Z` 是全 app 唯一一条 z 阶梯，每层的数字只在那里写一次：toast 30、dialog 50、page 70、pageDialog 80、floating 1000、floatingTop 1001、anchored 1100。要守的不变量是「锚定浮层画在它触发器所在的那层之上」，而触发器可以坐在阶梯的任何一层，所以 anchored 排在整条阶梯之上。调用点不写数字，`className` 里取 `OVERLAY_Z.<层名>`；全屏页那层归 `DialogFullScreenContent` 自己。这条阶梯是坑 103 立起来的。

## 各版改了什么

- 一（基座）：preflight、token 映射，Button / Input / Textarea / Label / Switch / Separator 六个原语，`BTN` 系列常量全部调用点。视觉变化都是收敛（三套紫、两套 hover 灰合一，`SourcesPage` 开关圆点归位，坑 77），探针里低于 44px 的可点元素从 52 个降到 33 个。
- 二（反馈类）：Toast 换 Radix Toast，`DeleteThreadButton` 的两步确认换 AlertDialog；浮层安全区（`ui/overlay.tsx`）和层级登记（`base/overlay-layer.ts`）在这版立起来，之后每版都靠它。
- 三（菜单）：`MoreMenu` 换 DropdownMenu，速读的 Filtered 折叠换 Collapsible。Popover 没用上。
- 四（对话框）：`SlidesDialog`（现在叫 `talk/DeckDialog.tsx`，宿主从 `NotesPanel` 换成了 `TalkView`）换居中 Dialog，`SettingsView` 换全屏 content 变体。风险最高，单独发一版。
- 五（收尾）：四个 `<select>` 换 Select，四个原生复选框换 Checkbox，紫底 chip 换 Badge，过渡期常量清干净。
- 之后：设置页从一个弹窗堆九组改成账号/功能/可选三个 Tabs，`SettingsView.tsx` 只剩壳，三个面板拆进 `settings/AccountPanel.tsx` / `FeaturesPanel.tsx` / `OptionalPanel.tsx`；Tabs 是这时候引的。

真机：五版都靠两份产物在 Chromium 里逐节点 diff 加逐像素对比核对几何与行为等价，一版一验、每版发 TestFlight 对比，但 iOS 幽灵点击本身当时都没有真机验证。第一次 iPad 真机驱动是在五版之后：改了两处——引用 chip 的命中区太小（换成 `relative` + `HIT_44`）、`DeleteTopicButton` 的 `window.confirm` 在 Tauri 下是同步的因此一按就删（换 AlertDialog，坑 98）。

## 阅读区的收敛

五版没碰阅读区那一侧，它一直是另一套写法。这一次只统一外观：颜色换成 token，能用变体表说清楚的换成 `<Button>`，行为一行没动。

盘出来的手写控件按视觉分五类：图标按钮（笔工具 4 个 + 色板开关 + 色板里每个颜色、标注气泡的 9 个色块和关闭、痕迹行的 AI 线索和删除、气泡的展开、通话卡的挂断、回复下的 Copy）、文字按钮（标注气泡的 Delete、滑动删除的那条红条）、选中态（笔工具选中、色板当前色、标注气泡当前色、痕迹选中行、侧栏当前标签）、危险操作（上面那三处红）、列表行（大纲、记忆、prep、痕迹）。

**颜色的判断**：

| 原来 | 现在 | 判断 |
|---|---|---|
| `bg-sky-100 text-sky-700`（笔工具/色板选中） | `bg-secondary text-secondary-foreground` | 选中是一种级别不是一种色相，token 里没有蓝 |
| `bg-violet-100 text-violet-700`（AI 笔选中） | 同上 | 同一个选中态，不再分两种 |
| `text-violet-500`（AI 笔静息、痕迹里的 AI 线索）、`text-[#7c5cff]`（通话卡） | `text-primary` | 表达的是「AI 的东西」，那就是品牌紫 `#6c4fd0` |
| `ring-sky-600`（选中环） | `ring-primary` | 同上 |
| `bg-sky-50` / `hover:bg-sky-100`（痕迹选中行） | `bg-secondary` / `bg-secondary-hover` | 同选中态 |
| `before:bg-sky-600`（选中行左边那条） | `before:bg-primary` | 同上 |
| `hover:bg-black/5`、`bg-black/[0.06]`、`hover:bg-neutral-100` | `bg-accent` | `#f2f2f2` / `#f0f0f0` / `#f5f5f5` 三个几乎一样的灰合成一个 |
| `text-[#555]`、`text-[#1b1b1b]`、`border-[#dcdcdc]` | `text-muted-foreground`、`text-foreground` / `text-accent-foreground`、`border-border` | 取值本来就相同，纯换名 |
| `text-red-700`、`bg-red-600`、`text-red-600/90` | `text-destructive` / `bg-destructive`（`#b91c1c`） | 三种红收敛成一个 |
| `bg-[#efecfb]` / `#4a3a9e` / `#e2dcf6` / `#c9bff0`（图卡片） | `secondary` 那一组 | 前两个取值相同，后两个各差一点 |
| `bg-blue-600`（发送）、`focus-within:border-blue-500`（输入框） | `bg-primary` / `border-primary` | 全项目仅有的蓝，主操作就是品牌紫 |

红取 `#b91c1c`：它是 `--destructive`，也是原来 `text-red-700` 和滑动删除按下态 `bg-red-700` 的值。滑动删除那条红条因此从 `#dc2626` 变深到 `#b91c1c`，按下态 `#991b1b`。

**换成 `<Button>` 的**：笔工具的 4 个工具键和色板里的颜色键、标注气泡的 9 个色块 / 关闭 / Delete、痕迹行的 AI 线索和悬停删除、侧栏的 5 个标签、气泡的展开、通话卡的挂断、回复下的 Copy。全部是 `variant="ghost"` 加 `size={null}`——这些控件自带方形几何，尺寸表里的 `icon` 是 32px 而它们是 24/28/36/44。`size={null}` 是 cva 的显式退出（`variantProp === null` 时连 `defaultVariants` 都不套）。`TraceList` 的 `ICON_BTN`、`PenToolbar` 的 `TOOL_BTN` 删掉，`AnnotationPopup` 的 `ICON_BTN` 和 `Sidebar` 的 `TAB_BTN` 只剩几何。

覆盖 ghost 的悬停底色一律写一模一样的修饰符链（坑 78）。选中态要写 `can-hover:hover:bg-secondary`：不写的话 ghost 的悬停灰会盖掉选中的紫。

`hover:` 一律挪到 `can-hover:hover:` 后面，触摸上不再有点一下卡住的悬停态。

**留在原地的**：

- 笔工具的颜色点和痕迹行的类型图标：颜色由标注本身决定，走 inline style。
- 麦克风键的录音三态背景（`bg-red-50` / `bg-neutral-200`）：红是「正在录」，灰是「松手取消」，是状态不是级别。静息态的悬停灰换了。
- 滑动删除那条红条的宽度：`SWIPE_ACTION_WIDTH` 走 inline style，手势逻辑按它算。只换了颜色。
- 状态 chip 的色阶（`PrepPanel` / `NotesPanel` / `ObservationPanel` / `SlidesDialog` 的 amber/green/sky/violet/red/neutral）：这是一组互相区分的分类色，不是控件级别。
- 停止键的深灰（`bg-neutral-800`）、暂存图片的黑色 ✕：token 里没有对应角色。
- 中性灰文字（`text-neutral-400/500/600/700/800`）和卡片描边（`border-black/10`）：整套表面色阶，换名会动到几十个节点的实际色值，和这一版的目的无关。
- 聊天输入区（textarea、发送、停止）、`ReadingPipCard`、`FigureCard` 的卡片本体、各处列表行：仍是手写 `<button>`，理由见「最终还剩的手写控件」。只换了颜色。
- 笔工具的色板开关一度留成原生 `<button>` 加 `buttonVariants()`，因为当时 `<Button>` 吃掉 ref。原语改成 `forwardRef` 之后换回 `<Button>`，见「ref 透传」。

**验证**。探针页加了 9 个静态节区（笔工具四态、横排、痕迹列表、侧栏、大纲、记忆、图卡片、两张 pip 卡、麦克风三档、流式输入框）和 2 个驱动节区（色板展开、痕迹行滑开）。驱动节区单开一页（`#drive`）：`SettingsView` 是常开的 Radix 模态，`body` 上的 `pointer-events: none` 让同一页上别的东西一个都点不动。

几何零变化。32 个节区共 1132 个节点，前后无一增删，170 个节点有属性变化，全部落在 `color` / `border-*-color`（跟着 `currentColor`）/ `background-color` / `cursor` / `gap`（`normal → 6px`，单子元素）/ `flex-shrink`（`[&_svg]:shrink-0`）/ `justify-content`（内容定宽的按钮）上。`_x/_y/_w/_h`、`padding`、`margin`、`min-height`、`border-width`、`font-size`、`line-height`、`border-radius`、`position`、`transform` 一个都没进差异表。coarse 那份跑同一段脚本，差异表逐条相同。

驱动态同样：色板相对色板开关的位置、每个颜色键的盒子、痕迹行的位移和红条宽度前后相同，只有颜色变了。

逐像素：18 个节区完全相同，变的 9 个各有一条原因——选中态换紫（`pen-toolbar` 5040、`trace-list` 27786、`sidebar` 30959、`reader-chrome` 2428、`annotation-popup` 530）、发送键换紫（`chat` / `call` / `call-classroom-off` 各 1049）、错误红变深（`prep-panel` 292、`notes-panel` 294）、AI 星标换紫（`pip-cards` 62）。`home-cards` 那 52 个像素是转圈动画的取帧，base 自己跟自己比也差。

触摸目标：coarse 档位下 202 个可点元素，45 个低于 44px，逐行（节区 + 标签 + 文本 + 宽高 + 字号）前后完全相同。其中原有的 23 个节区仍是 143 个可点元素、27 个低于 44px，和第五版记的数字一致。

`<Button>` 的透传实测（生产构建）：渲染出来的是原生 `<button>`，属性只多一个 `data-slot="button"`，`type` / `title` / `aria-label` / `aria-expanded` 原样带过，`onClick` 照常触发（痕迹行的删除是靠它驱动出来的）。`ref` 当时不透传，后来修了，见「ref 透传」。

## ref 透传

shadcn 生成的组件是照 React 19 写的（那里 `ref` 是普通 prop），本项目在 React 18，`ui/` 下没有一个是 `forwardRef`，传进去的 ref 恒为 `null`，`tsc` 全绿、生产构建没有警告（坑 95）。包 Radix 的那些也一样：接到 ref 的是这里的包装函数，ref 在到达 Radix 之前就没了。

现在 `ui/` 下每个渲染 DOM 节点的组件都是 `forwardRef`，ref 落在它实际渲染的那个元素上。不改的是只有 context 和状态、不产生 DOM 的那几个：Radix 的 `Dialog` / `AlertDialog` / `DropdownMenu` / `Select` 根、各种 `Portal`、`ToastProvider`、`OverlayLayer`。

`asChild` 下 ref 交给 `Slot`，它和被替换子元素自带的 ref 合并到同一个节点。实测（生产构建）：`<Button asChild ref={a}><a ref={b} /></Button>`，两个 ref 都拿到那个 `<a>`，`a.current === b.current`；旧版 `a.current` 是 `null`。

`AlertDialogAction` / `AlertDialogCancel` 的 ref 写在里面那个 Radix 部件上，不写在外面的 `Button` 上——`asChild` 的那个是 `Button`，它渲染出来的就是这个子元素。

护栏：`tests/ui/components/forward-ref-contract.test.ts`。`ui/` 下每个文件都要登记在表里，每个大写开头的导出要么是 `forwardRef` 产物要么在「不渲染 DOM」的名单里，每个 `React.forwardRef<` 都要有一处 `ref={ref}`。测试环境只有静态渲染，跑不到 ref，所以断言的是让 ref 能落地的那两件事；另外直接调 `Button.render(props, ref)` 看 ref 落在哪个元素上。

笔工具的色板开关跟着换回 `<Button>`。它是色板的锚点，`useLayoutEffect` 量不到节点就整条早退、色板停在原点。实测（两份产物，同一段驱动脚本）：笔工具静息态和色板展开态共 21 + 若干节点的盒子、class 串和计算样式逐字节相同，属性只多一个 `data-slot="button"`；色板相对开关的位置三档都相同——正常展开 `dx 44`、贴视口右缘夹取 `dx 1`、右边放不下翻到左边 `dx -140`。32 个静态节区逐节点 diff 只有 1 处变化，是 `home-cards` 那个转圈动画的取帧（base 自己跟自己比也差）。

## 没引的

**Tabs** 后来在设置页重组时引了（见「各版改了什么」）。侧栏那三个标签（`reader/Sidebar.tsx`）仍未换：它们已经是 `h-11` 的 44px 按钮，换过去买到的是方向键漫游和 `role="tablist"` 语义，代价是把抽屉的高度链（`min-h-0 flex-1` 那条）拆开重接。这条是真未决，哪天侧栏因为别的原因动的时候顺手做。

**Tooltip**。全项目 32 个 `title=`，都是图标按钮的悬停提示。触摸上不触发，所以每个需要说明的控件本来就有 `aria-label`，激活态还会把文字显出来（侧栏标签、MoreMenu 的行）。加一层 Radix Tooltip 只对鼠标有用，且要处理它自己的 Portal 和安全区。

**Popover**。第三版就说了没用上，第五版也没有新的锚定型浮层。现存的 `CallBubble` / `AnnotationPopup` 在不迁清单里。

## 最终还剩的手写控件

不是遗留，是终态。

- 阅读区标注层、`PenToolbar` 的色板、`AnnotationPopup`、`CallBubble`、`MicButton` 的按住录音、`TraceList` 的滑动删除、`ReadingPipCard`：没有对应的 Radix 原语，或者已经按实测结论调过（坑 67、`panel-position.ts`、`useKeyboardInset`）。
- 聊天输入区（`chat.tsx` 的 Composer、`ChatPipCard`）：自动增高、图片贴片、语音接管都是自己的逻辑，textarea 只是里面的一块。
- 侧栏标签行、`Sidebar` 的抽屉和背板、`LibraryScreen` / `BriefingPage` / `PrepPanel` 的列表行：`<button>` 就是它们该有的样子，包一层组件不会少写一行。
- `HomeCard` / `InfoCards` 的卡片外壳、`settings/cardStyles.ts` 的 `CARD`：shadcn 的 Card 是 header/content/footer 三段式，这里的卡片没有那个结构。

`src/` 里现在没有 `<select>`。原生复选框回来了一处：`NewTalkDialog`（后加的，晚于五版）的多选列表用裸 `<input type="checkbox">`，没走 `ui/checkbox.tsx`（现在只有 `FeaturesPanel`、`SyncCard`、`AutostartCard` 三处调用它）。`<input>` 因此是三处：`ui/input.tsx`、`SourcesPage` 的 URL 输入框、`NewTalkDialog` 那个复选框；`<textarea>` 仍是三处：`ui/textarea.tsx`、`AnnotationPopup`、聊天输入区。

这份清单说的是组件：这几个组件仍然自己写，不套 Radix。它们内部的按钮在「阅读区的收敛」里换成了 `<Button variant="ghost">`（同一个原生 `<button>`，样式来自变体表），侧栏标签行同理。裸 `<button>` 从 37 处降到 27 处：列表行、聊天输入区的三个键、`ReadingPipCard`、`FigureCard` 的卡片本体。

`SourcesPage` 的输入框和 `AnnotationPopup` 的 `<textarea>` 不是漏换，是判断过留下的：`SourcesPage` 的输入框走 info 侧自己那套圆角和描边，coarse 下本来就是 44px / 16px，套 `ui/input.tsx` 的字段外衣买不到东西；`AnnotationPopup` 的 `<textarea>` 是标注气泡内部的一块，气泡整体在「不迁的」清单里（锚定定位靠 `panel-position.ts`，已经按实测结论调过），单把这一块换成 `Textarea` 会让它和气泡剩下的手写部分（色板、按钮几何）不一致。

## 验证方法

比截图比对准的做法：`bun run build` 之后 `cd dist && python3 -m http.server`，把旧 CSS 拷成 `dist/before.css`，页面里切 `link.href`，同一 DOM 上前后各取一次 `getComputedStyle` 直接 diff。纯 CSS 改动不必重建 app。

改组件就不够了，要两份产物。第一版是这么做的：`origin/main` 的源码单独导一份到 `/tmp/base-app`，两边各加同一个探针页（挂真组件 + 固定 fixture，覆盖浏览器进不去的 22 个屏），各自 `vite build`，两个静态服务器，playwright 驱动 Chromium 按「节区内的 DOM 序号 + 标签名」逐节点 dump 几何和计算样式再 diff，同时对每个节区截图做逐像素对比。

探针页里 `position: fixed` 的东西（`SettingsView`、`Toast`、`AnnotationPopup`）会盖满整页，每个节区截的都是同一张图；给节区加 `transform: translate(0)` 让它成为 fixed 的包含块就好了。

测 `coarse:` 变体：整份 dist 复制一遍，在副本的 CSS 里把 `@media (pointer:coarse)` 换成 `@media all`，另起一个端口。不能只在 HTML 里加一个改造过的 `<link>`，原因见坑 79。

测安全区：同样的复制手法，把副本 CSS 里每个 `env(safe-area-inset-*)` 换成 `var(--sa-*, 0px)`，驱动脚本往 `:root` 上设这四个自定义属性就能给页面任意一组 inset。桌面浏览器的 `env()` 恒为 0，没有别的办法。改完等 400ms 再量：开场动画没跑完时 `getComputedStyle` 给的是过程值（150ms 时量到的 `max-height` 是 788.465px，实际是 782px）。

要驱动的交互（浮层开合、确认、点外面）单独一个脚本，不走静态 dump：Portal 出去的节点不在任何 `[data-screen]` 里，逐节点 dump 看不见它们。探针里那个宿主组件要真的会卸载——`onClose` 只记一笔数不卸载的话，两种实现都能把删除跑通，问题就测不出来。想证明某个保护确实必要，就把它拆掉再单独构建一份产物（`--outDir dist-probe-noguard`）跑同一段脚本，对照两边的计数。

纯浏览器里能起来的界面只有 Vestibule / Library / Settings（Tauri 存储调用会报错但 UI 正常渲染），其余全靠探针页。

第三版加的几条：

- 要驱动的浮层单独开节区，标 `data-drive` 而不是 `data-screen`，逐节点 dump 就自动跳过它们。同一个浮层在旧版是在流里、在新版是 Portal 出去的，节区内的 DOM 序号对不上，比的应该是「面板相对触发器的位置」和「每一行的盒子」。
- 那种节区不能带 `transform`：popper 是 `position: fixed`，有 transform 的祖先会变成它的包含块，这是探针独有的假象。
- 加了包装节点的组件（Collapsible 关着也渲染一个隐藏 div）会把 DOM 序号整体推后一位，逐节点 diff 全是噪声。按「标签 + 文本 + class + 第几个」重新配对再比，才看得出除了那个包装节点之外有没有东西真的动了。
- 逐像素比浮层要给两边都加 `--disable-lcd-text`（坑 86）。
- `(hover: none)` 在桌面浏览器里改不出来，`-coarse` 那份改造只动 `pointer: coarse`。要量 `can-hover:` 的实际效果得开 Chromium 的移动模拟（`isMobile: true`），那时两个媒体查询才都成立。
- 「换了实现之后行为等价」这类结论，对照组不止旧版：把新版里那一处保护单独去掉再构建一份（`--outDir dist-probe-noguard` / `-stock`），同一段脚本跑三份，才知道保护是不是真的在起作用。

第四版加的几条：

- 驱动页要真的能滚：`html, body, #root { height: 100% }` 的探针页里 `window.scrollY` 恒为 0，滚动锁就没有东西可锁，还原也证明不了。另外给页面一个自己的滚动容器，两个 `scrollTop` 一起对照。
- 打开对话框的那个按钮要 `position: fixed`。playwright 的 `click` 会先 `scrollIntoViewIfNeeded`，滚动位置本身是被测量的东西，被它改掉的话每一栏都对不上。
- 模态对话框不能挂在静态探针页里长期开着：`modal` 给 `body` 加的 `pointer-events: none` 会让页面上其它节区一个都点不动。逐节点 dump 的页面和驱动页分开。
- 软键盘造不出来。桌面 Chromium 没有软键盘，CDP 也没有对应的开关，能做的只有几何模拟：假定底部 K 像素不可见，逐个字段 `focus()` 之后量它落在哪。这能证明"新旧一样"，不能证明"iOS 上够用"。
- 两个 dist 的同一个浮层，逐像素差异先看有多少超过阈值再下结论：背板透明度改了 10% 就会让盒子边缘和圆角上的每一个像素都进差异表（白底透出来 152 → 126），数字很大但只有一条原因。

阅读区收敛加的几条：

- 静态 dump 的页面里挂着一个常开的 Radix 模态（`SettingsView`），它给 `body` 的 `pointer-events: none` 让整页都点不动。驱动节区要么单开一个入口（这次用 `#drive` 的 hash 分叉，同一份产物两个页面），要么另建一份探针。
- 探针页整体是一列，`MessageList` 挂载时把最后一行滚进视口，等于把页面滚到几千像素外；驱动脚本先回滚到顶再点，或者干脆让驱动页只装要驱动的东西。
- 新加的节区容器不要写死高度：coarse 那份每个控件 44px，短容器会把 flex 子元素压扁，量出来的是被挤过的尺寸（笔工具的 44×44 量成 44×23.4）。
- 原语当时不透传 `ref` 而且不报错（坑 95）。换掉一个被 `ref` 拿着的按钮之前，先在产物里读一次 `ref.current`。

第五版加的几条：

- 换掉的控件会让节区里的 DOM 序号整体错位，逐节点 diff 全是噪声。按「标签 + `type`/`role` + 文本 + 第几个」重新配对（`diff-pair.ts`），才看得出别的东西有没有动。
- 整页高度变了 1–2px 的时候，逐像素对比会把下面每一行字都算成差异。把页面按节点 dump 给出的位移分带，各带按各自的位移裁一次再比：位移抵掉之后剩下的才是真差异。
- 原生 `<select>` 的列表是浏览器画的，不在 DOM 里，旧版没有可比的开态。开态那一版只有新版这一份产物，它的对照是第三版的 DropdownMenu 和把某个保护拆掉的那份。
- 探针页里贴边的控件不要放在固定宽度的容器里：`coarse` 那份的字号更大，控件会溢出容器跑到视口外，playwright 的点击点被夹回来就落到别的元素上。让节区跟着视口宽。

引用 chip 这次加的几条：

- 给行内元素加 `relative` 会让它掉出行内绘制层进到定位元素那一层，同一行字的次像素抗锯齿变成灰度：几何逐字节相同，逐像素对比却在 chip 附近亮 6 个点（蓝通道 237 → 251）。和坑 86 同因，两边都加 `--disable-lcd-text` 之后 33 个节区全部逐像素相同。
- 命中区的普查按「节区 + 标签 + 文本 + 第几个」配对前后两份 dump 再比尺寸，比只看「低于 44px 的个数」有用：能证明动的正好是那 15 个 chip，别的可点元素一个没动。
- 「一按就删」这种结论在浏览器里默认测不出来：`window.confirm` 在浏览器里是同步的，旧代码的守卫照常生效，playwright 还会自动关掉原生确认框。要复现得先 `addInitScript` 装上 Tauri 注入的那版 `window.confirm = async …`。删除本身在浏览器里跑不完（要写 Tauri 的 fs），那次失败正好可以当计数器：数 `unhandledrejection` 就是数「进了几次 deleteTopic」。
