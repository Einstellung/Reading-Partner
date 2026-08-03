# shadcn/ui 迁移

> 本文记录 UI 组件迁到 shadcn/ui 的共识。现状按 2026-08-01 的代码查证（`dab38fa` 之后）。
>
> 落地状态（2026-08-03）：五版全部落地，迁移完成。之后补了一次阅读区的配色收敛（见「阅读区的收敛」）和一次 ref 透传修复（见「ref 透传」）。
>
> 一：preflight、token 映射、Button / Input / Textarea / Label / Switch / Separator 六个原语，以及 `BTN` / `BTN_PRIMARY` / `BTN_SM` / `BTN_SM_DANGER` / `FIELD` / `INPUT` 全部调用点。
>
> 二：Toast 换 Radix Toast，`DeleteThreadButton` 换 AlertDialog，浮层安全区那层（`ui/overlay.tsx` + `overlay-safe`）和浮层层级登记（`common/overlay-layer.ts`）立起来。
>
> 三：`MoreMenu` 换 DropdownMenu，速读的 Filtered 折叠换 Collapsible，锚定型浮层的安全区补进 `ui/overlay.tsx`。Popover 没用上，没引。
>
> 四：`SlidesDialog` 换居中的 Dialog，`SettingsView` 换新的全屏 content 变体。
>
> 五：四个 `<select>` 换 Select，四个原生复选框换 Checkbox，紫底 chip 换 Badge，过渡期的常量清干净。Tabs / Tooltip 没引，理由见「没引的」。
>
> `src/ui/components/ui/` 最终一共 15 个文件：alert-dialog、badge、button、checkbox、collapsible、dialog、dropdown-menu、input、label、overlay、select、separator、switch、textarea、toast。

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

依赖：`class-variance-authority`、`clsx`、`tailwind-merge`、`@radix-ui/react-slot`、`@radix-ui/react-label`、`@radix-ui/react-separator`、`@radix-ui/react-switch`，第二版加 `radix-ui` 和 `tw-animate-css`。没装 `lucide-react`（图标用项目自己的 `common/icons.tsx`）：`shadcn add` 生成的 dialog / dropdown-menu / select / checkbox 都从它取图标，每次都要换成 `common/icons.tsx` 的，或者连那一段一起删掉。五版下来 npm 依赖一个没再加，Select / Checkbox / Badge 全在 `radix-ui` 伞包和 cva 里。整包体积（JS + CSS，未压缩）第四版 3451.6 KB → 第五版 3478.0 KB，涨的 26.4 KB 是 Select 那一套；CSS 66.0 → 66.6 KB。

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
- `anchored`（DropdownMenu，以后的 Popover / Select）分两半，两半都要。位置那半是 Radix 的：content 上传 `collisionPadding={useOverlaySafePadding()}`，每边取 max(inset, 8px)。JS 读不到 `env()`（坑 84），所以 inset 是从一个隐藏探针元素的计算 padding 量来的（`common/safe-area.ts` + `styles.css` 的 `safe-probe`），在挂载和 resize 时量。尺寸那半是 CSS 的：`max-w-(--radix-popper-available-width) max-h-(--radix-popper-available-height)`，这两个变量是 Radix 按同一份 collisionPadding 算出来的剩余空间，配 content 自带的 `overflow-y: auto`，把「比它能待的地方还大」变成盒子内部滚动。用 popper 级的变量而不是每个组件自己的别名，同一串对每个 popper 浮层都成立。

  锚定型不写 `overlay-safe`：那条夹的是居中盒，锚定盒是移动而不是收缩。也不写 `anchor-safe`：那个 `@utility` 是给自己算坐标的 `position: fixed` 浮层用的（`CallBubble`），Radix 的坐标写在 popper 包装节点的 transform 上，`left`/`top` 夹取碰不到它。

  能保证的上限是锚点本身：`limitShift()` 不让浮层脱离锚点，所以锚点贴在视口边缘时浮层只能退到锚点边缘（坑 85）。外壳的 `p-safe` 把锚点推进安全区，这条才成立。

- `fullscreen`（盖住整个 app 的页：`SettingsView`，第五版可能还有）= `pt-safe-10 pr-safe-6 pb-safe-10 pl-safe-6`，加在页面自己那根内容列上，不加在 content 盒上。content 盒是 `fixed inset-0 overflow-y-auto bg-background`，不夹取——它就是视口，`overlay-safe` 那套 `max-w` / `max-h` 对它没有意义，而它的底色必须铺到屏幕边缘，安全区只推内容。数值是原来写在 `SettingsView` 里那一组，搬进来一处，调用点不再各写各的。

  这个变体的 content 有两处和别人不一样，都是必须的。

  **不 Portal。** 手机壳的左缘返回手势拿 `transform` 平移整个界面，`position: fixed` 的子元素只有还在那棵子树里才跟着走；Portal 出去之后它既不动，也收不到挂在那个元素上的 capture 监听（坑 89）。渲染在原地，DOM 位置和换之前一样。实测：把壳平移 120px，旧版全屏页移 120、新版也移 120，居中那个 Portal 出去的移 0。

  **不渲染 `DialogOverlay`。** Radix 把 `RemoveScroll` 放在 Overlay 里而不是 Content 里（坑 88），所以不渲染 Overlay 就没有滚动锁——全屏页盖住整个视口、自带滚动容器，底下没有东西需要锁，少一把锁就少一批要还原的 `body` 状态。也没有东西需要调暗，页面本身不透明。`modal` 仍然是 `true`：要的是焦点陷阱、身后一切的 `aria-hidden`、外部指针关掉，和 Escape。

必须用 `cn()` 而不是拼字符串：`max-width` 只能有一条。shadcn 生成的 AlertDialogContent 自带 `max-w-[calc(100%-2rem)]` 和 `sm:max-w-lg`，和 `overlay-safe` 特异性相同，谁赢取决于 Tailwind 把自定义 utility 排在哪里。改成 `w-full` / `sm:w-[32rem]`，`max-width` 归 `overlay-safe` 独占。

`cn()` 也只到修饰符串一模一样为止（坑 78）。DialogContent 原来照 AlertDialog 留了一条 `sm:w-[32rem]`，调用点写的 `w-[min(35rem,100%)]` 没有 `sm:`，去重去不掉，640px 以上一直是 512px 宽——盒子从 560 缩到 512，节点 diff 里看得清清楚楚。带断点的默认尺寸整条删掉，宽度归调用点，`w-full` 只做兜底。

`asChild` 干脆不过 `cn()`，它把两串 className 拼起来（坑 87）。用 `asChild` 保住原来的标签时，样式写在包装组件上而不是子元素上。

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

## 第三版：菜单与折叠

**`MoreMenu`**。`MoreItem` 那个类型和 `ReaderTopBar` 的调用点一个字没动。trigger 是原来那个按钮加 `asChild`（`aria-haspopup` / `aria-expanded` 交给 Radix，开着的样子改用 `data-[state=open]:`），action 行是 `DropdownMenuItem`，toggle 行是 `DropdownMenuCheckboxItem` 加 `onSelect` 里 `preventDefault()` 再调 `onClick`——不 prevent 就会关掉菜单，而 toggle 要留着连续翻。

行的几何自己写：13px、`min-h-[36px] coarse:min-h-[44px]`、`py-0`。菜单默认的 `[&_svg:not([class*='size-'])]:size-4` 和 `[&_svg:not([class*='text-'])]:text-muted-foreground` 是给 lucide 画的，会把本项目 18px 的自绘图标压成 16px 并改色，用一模一样的修饰符链覆盖成 `size-auto` / `text-current`（坑 78）。悬停底色不再自己写：Radix 在鼠标下会给行真正的焦点，`focus:bg-accent` 就是原来那个 `#f0f0f0`，而手指不会触发（Radix 的 `onPointerMove` 只认 mouse），比原来的 `hover:` 干净。

原来那条 document 上的 `pointerdown` 和 Escape 监听整个删掉，Radix 自己有。换来的是键盘可达：ArrowDown / Enter 开、方向键走、首字母跳、Escape 关，原来一样都没有。

**`modal={false}`**。默认的 `true` 会锁 body 滚动、给兄弟节点加 `aria-hidden`、用 `disableOutsidePointerEvents` 吞掉外面的第一按。阅读区不能接受这三条中的任何一条：书要能继续滚，屏幕阅读器不该在开着一个五行菜单时看不见整本书，点回书上应该直接生效。实测（开→关一轮，鼠标与触摸各一遍）`pointer-events`、`overflow`、`data-scroll-locked`、兄弟节点的 `aria-hidden` 全程没出现过，`window.scrollY` 三次读数相同，关闭后 body 上连空的 `style=""` 都没留下（第二版的模态对话框会留一个）。

**触摸**。trigger 改成在 click 上开，理由和做法见坑 83。无头 WebKit 在这台机器上仍然起不来，所以在 Chromium 的触摸上下文（`hasTouch` 加 `isMobile`，后者让 `(hover: none)` 和 `(pointer: coarse)` 真的成立）里验：一按开、再按关、按外面关、按行选中一次、toggle 不关，全部一次到位，不需要按两次。真机上没验的是 iOS 的幽灵点击本身，验的是它的前提——pointerup 那一刻 DOM 里有没有菜单。

**层级登记**。`DropdownMenuContent` 的 children 里挂 `<OverlayLayer />`。对 `MoreMenu` 这一处买到的是：菜单开着时按菜单里的行，不再被 `CallBubble` / `AnnotationPopup` 读成"按在外面"。用键盘开菜单（这样开菜单的那一按不参与）再按一行，对照两份产物：

| | 按菜单里的一行 |
|---|---|
| 有 `<OverlayLayer />` | 气泡还在，行触发一次 |
| 没有 | 气泡关闭并卸载，行照样触发一次 |

用指针按 trigger 打开菜单时气泡仍然会关——那一按发生在还没有任何层的时候，属于气泡，新旧一致。`App.tsx` 那条挂在阅读区 pane 上的 `onPointerDownCapture` 不受影响：Portal 出去的节点在 React 树里的父级是顶栏，事件不经过 pane。`PenToolbar` 的色板和 `SourcesPage` 的 HealthDot 不会和这个菜单同时开着，没动。

**Collapsible**。`Collapsible asChild` 套在原来的 `<section>` 上，头换 `CollapsibleTrigger`，列表包进 `CollapsibleContent`。`open` 仍然受控，因为箭头是 `▾`/`▸` 字形切换而不是旋转。`can-hover:opacity-0` 的 "Show anyway" 一个字没改，在触摸档位下量到 opacity 1、92.1×44。关闭态多一个空的隐藏 `div`（Radix 的 content 包装节点即使关着也渲染，子树仍然不挂载）。

**视觉变化**：两处，都是"亮起来的状态原来没亮"。lit 的 toggle 行的文字从 `#333` 变成 `#4a3a9e`，开着的 trigger 的箭头从 `#555` 变成 `#1b1b1b`。原来两处都是把两个 `text-*` 直接拼在一个 className 里，谁赢由 Tailwind 把它们排在哪决定，赢的都是不该赢的那个；现在一个走 `cn()`，一个走 `data-[state=open]:` 修饰符。除此之外菜单打开态逐行逐属性相同，面板相对触发器的位置 `[-192, 36, 224×220]` 两边一致。

**依赖**：`dropdown-menu` 和 `collapsible` 的 registry 版本都不带新 npm 包（`radix-ui` 伞包已经在）。生成的 `dropdown-menu.tsx` 删掉了 Sub / RadioGroup / RadioItem / Shortcut 和 CheckboxItem 的对勾指示器——只有它们要 `lucide-react`，本项目不装。这次 `add` 没有覆盖 `button.tsx`（坑 81 仍然要每次 `git status`）。`collapsible.tsx` 生成时用了 `React.ComponentProps` 却没 import React，补上。产物：App chunk 637.6 → 682.4 KB（gzip 182.7 → 198.7），CSS 62.7 → 65.8 KB，涨的是 popper 那一套和 `tw-animate-css` 里菜单用到的进出场。

## 第四版：两个对话框

**都不用 `DialogTrigger`。** 两处的宿主（`App` / `PhoneApp` 的 `showSettings`、`NotesPanel` 的 `showSlides`）本来就挂载卸载这两个组件，保持原样：`open` 常真，`onOpenChange` 只用来接 Radix 自己决定的关闭。调用点一个字没改。顺带绕开了坑 83——Radix 的 Dialog trigger 开在 click 上，但根本没有 trigger 就不必论证。

**`SlidesDialog`** 换居中的 `DialogContent`，`modal` 保持默认的 `true`：底下是阅读区，模态期间它不该滚也不该被点到。外壳那个手写的 `fixed inset-0 bg-black/40` 背板连同 `onClick={onClose}` 和内层的 `stopPropagation` 一起删掉，改由 Radix 的 Overlay 和 DismissableLayer 负责。盒子里的分工没动：头固定、`flex-1 min-h-0 overflow-y-auto` 的身子滚动，所以 `overlay-safe` 带来的那个 `overflow-y: auto` 在 content 上永远没事可做。

**`SettingsView`** 换全屏变体，做法见「浮层的规矩」。原来写在内容列上的 `pt-safe-10` 那一组换成 `OVERLAY_SAFE.fullscreen`，值不变。

**滚动锁**，开→关一轮实测（Chromium，鼠标与触摸各一遍，页面本身可滚且里面另有一个滚动容器）：

| | `SlidesDialog` 开着 | 全屏设置页开着 |
|---|---|---|
| `body` `overflow` | hidden | visible |
| `data-scroll-locked` | 在 | 无 |
| `<head>` 里注进去的 `<style>` | 1 | 0 |
| `body` `pointer-events` | none | none |
| 兄弟节点 `aria-hidden` | 全部 true | 全部 true |
| `padding-right` 补偿 | 0 | 0 |

关闭之后两条路都逐项还原，`window.scrollY` 三次读数都是 500，里层滚动容器的 `scrollTop` 三次都是 300，页面中心 `elementFromPoint` 命中的元素 `pointer-events: auto`。唯一残留仍是 `body` 上一个空的 `style=""`（第二版同样）。

**幽灵点击**。量的是它的前提：打开对话框的那一按抬手时，对话框在不在 DOM 里。Chromium 的触摸上下文（`hasTouch` + `isMobile`）里跑，三份产物同一段脚本：

| | pointerup 时对话框已存在 | 同一按顺手触发了里面的控件 |
|---|---|---|
| 旧版 | 否 | 否 |
| 新版 | 否 | 否 |

Radix 的 Dialog trigger 开在 click 上，而且这里连 trigger 都没有，宿主的 `onClick` 就是原来那个。无头 WebKit 在这台机器上仍然起不来（缺 `libavif16`，没有 sudo），iOS 上的幽灵点击本身还是没有实机验证。

**返回导航**。手机壳的 `goBack` 走 `resolveBack` → `pop`，Escape 走 Radix 的 `onOpenChange` → `onClose` → 同一个 `goBack`，两条路不交叉：Escape 那条不改栈以外的任何东西，系统返回键和左缘手势那条根本不经过 Radix。实测 Escape 关掉两个对话框各一次（旧版两个都关不掉，本来就没有 Escape）。左缘手势那条靠"不 Portal"成立，见上。

**软键盘不做避让。** 两个对话框都是 `position: fixed` 贴在 layout viewport 上，`overlay-safe` 夹的是 `dvh`——iOS 的键盘只改 visual viewport，这两样都不动，所以键盘弹起时对话框一寸没移，WebKit 自己把 visual viewport 平移到聚焦的字段上，和换之前完全一样。加一个 `useKeyboardInset` 的偏移反而会和那次平移叠加。`CallView` 需要它是因为它的输入条钉在底边，必须在键盘上方待着而不是被滚动到。

能量的部分（视口 900×800，模拟 336px 键盘，逐个字段 `focus()` 后取几何）两份产物逐字节相同：居中盒 `[162, 638]`、被盖住 174px、textarea `[362, 426]` 未被盖住；设置页四个字段的位置和"是否被盖"四项相同。量不到的是 WebKit 那次平移本身——桌面 Chromium 造不出真的软键盘，CDP 也没有对应的开关。

**视觉变化清单**。除下面这些之外，23 个节区逐节点相同（`home-cards` 里那个转圈动画的取帧仍然是唯一噪声），两个对话框打开态各自 35 / 93 个节点的几何与计算样式逐字节相同：

- 背板从 `bg-black/40` 变成 `bg-black/50`，和第二版的 AlertDialog 统一。居中盒的逐像素对比里 11134 个差异像素全部是这一条：超过 20 的 2052 个都在盒子边缘和圆角，白底透出来的灰从 152 变成 126。
- 居中盒的高度上限从 `max-h-[85vh]` 变成 `overlay-safe`（`100dvh - 2 * max(inset, 16px)`），横向从"背板 `p-6` 撑出的 24px 边距"变成 16px 槽宽。这是「浮层的规矩」要求的：高度只能有一条。实际内容撑不到上限，桌面上盒子仍是 560×476。
- 对话框标题从 `<div>` 变成 `DialogTitle`（`<h2>` / `<h1 asChild>`），行高显式写成 `leading-normal`（坑 90）。
- 打开时 Radix 把焦点放到第一个可聚焦元素（Done / Close）。用指针打开时 `:focus-visible` 不成立，看不见焦点环——探针页里那 358 个差异像素是因为它从加载起就没有过任何交互，实测点击打开后 `focusVisible: false`。
- Escape 现在能关掉两个对话框，原来都不能。

**安全区**（`-safe` 改造产物，三组 inset）：

| | 无 inset | 竖屏 59/34 | 横屏 50/50 |
|---|---|---|---|
| 全屏页盒子 | 900×800 | 900×800 | 900×800 |
| 内容列 padding | 40/24/40/24 | 59/24/40/24 | 40/50/40/50 |
| 居中盒 `max-w`/`max-h` | 868/768 | 868/682 | 800/758 |

页面盒子在任何一组 inset 下都铺满，底色到边；内容列吃掉 inset。居中盒原来完全不跟 inset 走（`max-h` 恒为 680），现在跟。

**层级登记**的对照（拆掉 `<OverlayLayer />` 单独构建一份 `dist-probe-noguard`，键盘打开对话框，再用指针按里面的一个按钮）：

| | 气泡 | 按钮 |
|---|---|---|
| 有 `<OverlayLayer />` | 还在 | 触发一次 |
| 没有 | 关闭并卸载 | 照样触发一次 |
| 旧版 | 关闭并卸载 | 照样触发一次 |

两个对话框各跑一遍，结果相同。

**44px 与字号**（coarse 档位）：全项目 143 个可点元素、36 个低于 44px、2 个字段低于 16px，逐行和旧版相同（那 2 个是原生复选框，13×13）。对话框内部单独量：`SlidesDialog` 8 个可点元素、3 个低于 44px（三个原生复选框），Close / Generate / Open 都是 44 高，textarea 16px；设置页 21 个、9 个低于 44px（两个原生复选框和七个 42px 高的字段行，和旧版同数），所有文本字段与 select 都是 16px。

**依赖**：`dialog` 的 registry 版本不带新 npm 包，这次 `add` 也没有覆盖 `button.tsx`（坑 81 仍然要每次 `git status`）。生成的文件删掉了右上角那个关闭按钮——全文件只有它要 `lucide-react`，而且两个对话框各自都有 Done / Close。`ui/dialog.tsx` 的这些约定由 `tests/ui/components/dialog-contract.test.ts` 盯着，因为一次 `shadcn add dialog` 就能把它们全部换回默认那份。产物：App chunk 682.38 → 682.34 KB，CSS 65.75 → 65.96 KB。Dialog 和 AlertDialog 共用同一批内部件，JS 一点没涨（换掉的手写背板和外壳正好抵掉）。

## 第五版：Select、Checkbox、Badge

**四个 `<select>` 换 Select**，都走同一个 `settings/ChoiceField.tsx`：`<Label>` 包 trigger，选项从一个 `{value,label}[]` 来。原来四处各写一遍 `<option>` 循环。

`position="popper"`，不是生成的 `item-aligned`——只有 popper 发布 `--radix-popper-available-*` 也只有它收 `collisionPadding`，item-aligned 下「浮层的规矩」那两半一句都不生效（坑 91）。安全区照 `OVERLAY_SAFE.anchored` 加 `useOverlaySafePadding()`，`<OverlayLayer />` 在 content 的 children 里。

trigger 穿 `ui/input.tsx` 导出的字段外衣（`fieldClassName`），所以它和旁边的文本框同宽同边框同圆角；行的几何抄第三版的菜单行（36px，coarse 下 44px）。

trigger 的宽度要自己占住：原生 `<select>` 按最宽的 option 定宽，Radix 的只装选中那一行（坑 93）。

`modal` 保持默认的 `true`。开→关一轮实测（页面预先滚到 500，按坐标点击以免 playwright 自己滚页）：开着时 `body` 是 `pointer-events: none` / `overflow: hidden` / `data-scroll-locked` / `<head>` 里一个注进去的 `<style>` / 兄弟节点 `aria-hidden`，`padding-right` 补偿 0；关掉之后逐项还原，`window.scrollY` 三次都是 300，事后页面中心 `elementFromPoint` 命中的元素 `pointer-events: auto`。残留仍是 `body` 上一个空的 `style=""`。

**触摸不用绕**。坑 83 那套是给 DropdownMenu 写的，Select 自己就按指针类型分路（坑 92），照抄反而双开。

**四个原生复选框换 Checkbox**（`SettingsView` 两个、`SlidesDialog` 三个里的那一批、`SyncCard` 一个）。方块从 13×13 的 UA 控件变成 16×16 的紫色方块，触摸目标由 `HIT_44` 的居中伪元素扛，和 Switch 同一套。`<Label>` 仍然包着它：`<label>` 会把点在文字上的那一下转给里面的 `<button role="checkbox">`，实测点方块 toggle 一次、点文字再 toggle 一次，没有重复触发。

**紫底 chip 换 Badge**。同一串 className 在六个文件里出现过，其中两处还停在 `#6d5ae0`。变体两个：`source`（来源名）和 `aside`（"Out of your lane"）。是 `<span>` 不是 shadcn 的 `inline-flex`——这些 chip 只装一行字，改成 inline-flex 会动它在行内的落位。

**顺手收掉的紫**。第一版说 `#6d5ae0` 全部改掉，其实还剩 7 处：速读正文的链接色（`proseCss.ts`）、`PhoneHome` 的 "Open →"、`InfoCards` 的活动圆点、`PullToAsk` armed 态的药丸边和底、以及 Badge 收进来的两处。现在 `src/` 里除 `styles.css` 的注释外不再出现这个值。

**删掉的过渡期东西**：`ui/input.tsx` 的 `inputClassName` 改名 `fieldClassName`（它现在是两个原语共用的字段外衣，不再是"给还没有原语的 `<select>` 顶着"）、`InfoCards` 的 `PIPE_BADGE` 常量、`settings/cardStyles.ts` 和 `common/buttons.ts` 里已经过时的注释。`common/buttons.ts` 只剩 `HIT_44`；`cardStyles.ts` 只剩 `CARD`，六个设置卡片在用，留着。

**新增的护栏**：`tests/ui/components/primitive-contract.test.ts`，盯 select / checkbox / badge 里一次 `shadcn add` 就会消失的那些约定（`position="popper"`、`collisionPadding`、`<OverlayLayer />`、44px、`HIT_44`、不 import lucide、Badge 的两个变体）。`dialog-contract` 是它的第四版同类。

**视觉变化清单**。23 个节区里 18 个逐节点、逐像素完全相同，其余五处：

- 速读正文的链接、`article-saved` 的链接、`InfoCards` 的 RSS chip：`#6d5ae0 → #6c4fd0`。逐像素分别 258 / 258 / 119 个像素，最大差 16。
- 设置页：Language 字段 524.5×39 → 524.5×38，Thinking 字段 97×39 → 100.6×38（`line-height: normal` 变成 20px 少 1px；宽度见坑 93），两个复选框 13×13 → 16×16。整页因此矮 2px。把这 1/2px 的整体上移抵掉之后，页面上其余每一个像素都相同——四个控件之外没有任何东西动过。
- `SlidesDialog`：盒子仍是 560×476，差异像素 5080 个全部落在三个复选框那一小块 (15,95)–(431,159) 里，书名文字因方块变宽右移 3px。
- 三处 chip 的盒子、字号、内边距一个字节没变（Badge 的基串和原来那串完全相同）。
- 设置页的文本字段在 coarse 下从 42px 长到 44px（`fieldClassName` 加了 `coarse:min-h-[44px]`），细指针下不变。

**安全区**（`-safe` 改造产物，trigger 贴视口右缘）：

| | 列表右侧余量 | `max-width` | `max-height` |
|---|---|---|---|
| 无 inset | 8 | 884 | 742 |
| 竖屏 59/34 | 8 | 884 | 657 |
| 横屏 50/50 | 50 | 800 | 729 |

贴着底边的那个 trigger 上方开（`data-side: top`），列表整体在 trigger 之上。

**层级登记的对照**（拆掉 `<OverlayLayer />` 单独构建一份 `dist-probe-noguard`，键盘开列表，再用指针按一行）：

| | 气泡 | 那一行 |
|---|---|---|
| 有 `<OverlayLayer />` | 还在 | 选中一次 |
| 没有 | 关闭并卸载 | 照样选中一次 |

旧版没有这一栏：原生 `<select>` 的列表是浏览器画的，不是 DOM，压根没有"按在外面"这个问题。

**触摸目标的最终数字**（coarse 档位，全项目探针 23 个节区）：

| | 可点元素 | 低于 44px | 字段小于 16px |
|---|---|---|---|
| 第一版之前 | — | 52 | — |
| 第四版之后 | 143 | 36 | 2 |
| 第五版之后 | 143 | 27 | 0 |

清掉的 9 个都在设置页：两个 select（42→44）、两个复选框（13→44）、五个文本字段（42→44）。两个对话框内部单独量，`SlidesDialog` 8 个可点元素和设置页 21 个，现在低于 44px 的都是 0。

剩下的 27 个，逐项：

- 正文和聊天里的行内链接 6 个（`<a>`，21.7×18 到 28.4×23）。加 padding 会在句子里断行。引用 chip 当时也归在这一条里，归错了，见「真机之后：引用 chip」。
- 聊天/通话的输入框 4 个（textarea，高 32–36）和它们旁边的 Copy 按钮 3 个（34×30）。`docs/30` 不迁聊天输入区。
- `AnnotationPopup` 的色板和按钮 7 个（36×36、79.5×36）。不迁清单里。
- 列表行 6 个：prep 的三条论文行（335×35.5–38）、库的两条主题行和一条文件行（489×38.5）。行高由内容定，撑到 44 会把列表拉散；整行都是命中区，宽度有几百像素。
- prep 的 Add 按钮 1 个，42.6×44——差的是宽度，1.4px。给按钮尺寸表加一条 `coarse:min-w-[44px]` 会动到全项目每一个窄按钮，为这一个不划算。

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
- 状态 chip 的色阶（`PrepPanel` / `NotesPanel` / `MemoryPanel` / `SlidesDialog` 的 amber/green/sky/violet/red/neutral）：这是一组互相区分的分类色，不是控件级别。
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

**Tabs**。唯一像样的场景是阅读区侧栏顶上那五个标签（`reader/Sidebar.tsx`）。没换：它们已经是 `h-11` 的 44px 按钮，换过去买到的是方向键漫游和 `role="tablist"` 语义，代价是把抽屉的高度链（`min-h-0 flex-1` 那条）拆开重接。这条是真未决，哪天侧栏因为别的原因动的时候顺手做。

**Tooltip**。全项目 32 个 `title=`，都是图标按钮的悬停提示。触摸上不触发，所以每个需要说明的控件本来就有 `aria-label`，激活态还会把文字显出来（侧栏标签、MoreMenu 的行）。加一层 Radix Tooltip 只对鼠标有用，且要处理它自己的 Portal 和安全区。

**Popover**。第三版就说了没用上，第五版也没有新的锚定型浮层。现存的 `CallBubble` / `AnnotationPopup` 在不迁清单里。

## 最终还剩的手写控件

不是遗留，是终态。

- 阅读区标注层、`PenToolbar` 的色板、`AnnotationPopup`、`CallBubble`、`MicButton` 的按住录音、`TraceList` 的滑动删除、`ReadingPipCard`：没有对应的 Radix 原语，或者已经按实测结论调过（坑 67、`panel-position.ts`、`useKeyboardInset`）。
- 聊天输入区（`chat.tsx` 的 Composer、`ChatPipCard`）：自动增高、图片贴片、语音接管都是自己的逻辑，textarea 只是里面的一块。
- 侧栏标签行、`Sidebar` 的抽屉和背板、`LibraryScreen` / `BriefingPage` / `PrepPanel` 的列表行：`<button>` 就是它们该有的样子，包一层组件不会少写一行。
- `HomeCard` / `InfoCards` 的卡片外壳、`settings/cardStyles.ts` 的 `CARD`：shadcn 的 Card 是 header/content/footer 三段式，这里的卡片没有那个结构。

`src/` 里现在没有 `<select>`、没有原生复选框；`<input>` 只剩 `ui/input.tsx` 里那一个和 `SourcesPage` 的 URL 输入框（info 侧的圆角和描边是另一套，coarse 下本来就是 44px / 16px）；`<textarea>` 只剩 `ui/textarea.tsx`、`AnnotationPopup` 和聊天输入区。

这份清单说的是组件：这几个组件仍然自己写，不套 Radix。它们内部的按钮在「阅读区的收敛」里换成了 `<Button variant="ghost">`（同一个原生 `<button>`，样式来自变体表），侧栏标签行同理。裸 `<button>` 从 37 处降到 27 处：列表行、聊天输入区的三个键、`ReadingPipCard`、`FigureCard` 的卡片本体。

## 第一版的视觉变化

逐屏对比的做法在下一节。除下面这些之外，22 个屏的每个节点的几何和计算样式逐字节相同。

有意的：

- 紫色收敛（见上）。受影响：vestibule、home cards、InfoCards、SourcesPage、briefing / article / saved 的来源标签。settings 一个像素没动，那里本来就是 `#6c4fd0`。
- `LibraryScreen` 的两个输入框从 16px 变 14px。它们是全项目唯一没写字号的字段，靠 UA 继承到 16px，和别处 `text-sm` 的字段不一致；一起补上了 `min-w-0`（长标题原来会把行撑宽）。行高 42 → 38，下面的列表整体上移 4px。
- `SourcesPage` 的开关圆点回到正确位置。原来的手写 toggle 把圆点画在轨道外面，见坑 77。
- info 侧的按钮拿到 `cursor: pointer`。它们原来没写，鼠标停上去是箭头。
- 触摸目标：阅读侧面板的 11px 按钮（11 处）、纯文字链（8 处）、InfoCards 的 CTA（3 处）、CallView 的 Classroom、`ArticleView` 的 Keep 从 28–36px 提到 44px。探针里可点元素低于 44px 的从 52 个降到 33 个。

无视觉后果但会出现在样式 diff 里：`display: block → flex`（基类是 `inline-flex`，单子元素时几何不变）、`gap: normal → 6px`（同上）、`[&_svg]:shrink-0`、`size="link"` 带来的 `position: relative`。

剩下的 33 个低于 44px 的可点元素，都不在这一版的范围里：正文和聊天里的行内链接（`<a>`，加了 padding 就断行；引用 chip 后来从这一类里拆了出去，见「真机之后：引用 chip」）、聊天输入区（`docs/30` 不迁）、标注气泡（不迁）、设置页的原生复选框（Checkbox 不在这六个原语里）、库和 prep 的列表行（行高由内容定）。设置页所有真正的文本字段在 `coarse:` 下都是 16px。

## 真机之后：引用 chip

iPad 上驱动一轮之后回来改的两处。

引用 chip（`MarkdownRenderer` 把 `[p.12]` / `[fig:3]` 渲染成的那个 `<a>`）当时和「句子里的一段文字」归在一起，判为加 padding 就断行、有意留下。归错了：它有底色、圆角和自己的 `px-1 py-0.5`，是画出来的控件；`buttons.ts` 里 `HIT_44` 的注释列的适用对象正好包含它。真机上它是 31–36×18（笔记面板）和 29–80×22（聊天），而笔记面板里约 260 个、聊天里约 100 个，是从笔记跳回原文的主要入口。改成 `relative` + `HIT_44`：伪元素扛命中区，盒子、行高、断行位置一个都不动。真正留在原分类里的是模型写的普通外链，它们没有自己的盒子。

同一轮里书库删主题被换成 `AlertDialog`（`library/DeleteTopicButton.tsx`）。原来那条 `window.confirm` 在 Tauri 下点一下就删，原因和结论在坑 98。

**量出来的**（探针加一个 `citation-prose` 节区：两列正文，320px/12px 和 420px/16px，句中、连着两个、跨行折断、行尾各一个 chip）：

| | 前 | 后 |
|---|---|---|
| 33 个节区逐节点几何和计算样式 | — | 全同（唯一一条差异是 home cards 那个呼吸动画的 opacity 采样） |
| 两列段落高度 | 195 / 260 | 195 / 260 |
| 每个 chip 的盒子 | 29.9×19 … 67.1×23 | 一个像素没动 |
| coarse 下的命中区 | 19 / 23 高 | 15 个 chip 全部 ≥44×44 |
| 探针里低于 44px 的可点元素 | 60 | 45 |
| 逐像素（`--disable-lcd-text`） | — | 33 个节区全同 |

驱动删除（探针的 `library-delete` 节区，删除失败的那次 rejection 当计数器）：

| | 结果 |
|---|---|
| 旧版 + Tauri 注入的 async `confirm` | 一按就删，0 个确认框 |
| 旧版 + 浏览器的同步 `confirm` | 弹原生确认框，0 次删除（所以浏览器里一直看不出问题） |
| 新版 按 Delete | 1 个 `alertdialog`，0 次删除 |
| 新版 Cancel / Escape | 0 次删除 |
| 新版 在对话框里按 Delete | 正好 1 次 |

834px 宽、`coarse` + `isMobile` 下再量一次对话框：触发按钮 54.5×44，Cancel 和 Delete 各 69.6×44 和 68.6×44，content 带 `overlay-safe`，`max-height` 被夹到 1080px 且 `overflow-y: auto`，`body` 拿到 `overflow: hidden` 和 `pointer-events: none`。

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
