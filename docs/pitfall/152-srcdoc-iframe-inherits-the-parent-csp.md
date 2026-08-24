# srcdoc iframe 继承父页的 CSP，deck 的内联脚本是靠 app 的 `'unsafe-inline'` 活着的

现象：把生成好的 deck（自包含单 HTML，内联 `<style>` + 内联 `<script>` + base64 图）塞进 app 内的 iframe 放映（`src/ui/components/talk/RehearsalView.tsx`）。app 的 CSP 是 `frame-src 'self'`，另有 COOP `same-origin` + COEP `require-corp`。预期是 iframe 被 `frame-src` 拦掉、或者内联脚本跑不起来、或者几 MB 的 srcdoc 卡住主线程——三件都没发生，而真正的耦合藏在别处。

实测（WebKitGTK 2.52.3，`xvfb-run` 无窗口，真 CSP 响应头，探针脚本在 scratchpad）：

- `srcdoc` 能过 `frame-src 'self'`：`securitypolicyviolation` 一条没有，iframe 正常 load。
- deck 的内联 `<script>` 照跑，`postMessage` 打得出来，父页 `e.source === iframe.contentWindow` 为真。
- 宿主 → deck 的 `postMessage` 也通，deck 按 goto 跳页后回报新页号。
- 22.28 MB 的 deck（20 页、每页约 900 KB base64 图，`srcdoc` 属性 23,359,775 字节）：fetch 137 ms，写 `srcdoc` 属性 13 ms，appendChild 41 ms，iframe load 完成 415 ms。5.74 MB 的那份是 load 282 ms。没有可感知的卡顿。
- `blob:` URL 的 iframe **也**没被拦，尽管 `frame-src 'self'` 里没有 `blob:`（`child-src` 里有，但对 frame 来说 `frame-src` 优先，本该轮不到 `child-src`）。所以"要用 blob 就得先改 CSP"这个推断在这个 webview 上不成立。

原因：`about:srcdoc` 和 `blob:` 都是 local scheme，文档的来源继承自创建它的页面，CSP 也一并继承——它们不是"一次导航到某个 URL"，`frame-src` 那关根本没有 URL 可查。继承带来的后果是反过来的那条：deck 的内联脚本能跑，不是因为 deck 自己说了算，而是因为 app 的 `script-src` 里有 `'unsafe-inline'`。deck 文件在浏览器里双击打开时没有任何 CSP，在 app 里它受 app 的 CSP 管。

解法：用 `srcdoc`，CSP 一个字都不用改。要记住的是那条继承：`script-src` 的 `'unsafe-inline'` 哪天收紧，app 内放映的每一张 deck 会同时变白屏，而 deck 文件本身、`template.ts`、`tauri.conf.json` 三处谁都不会写着这件事。真收紧的话 deck 那侧要改成外链脚本或带 nonce，而 deck 的第一条要求是"浏览器打开即放映、零外部依赖"，两者是冲突的。

附带两条：

- iframe 里的 keydown 监听挂在它自己的 `document` 上，宿主不给它焦点就一个按键都收不到。`iframe.load` 之后调 `contentWindow.focus()`，实测之后父页的 `document.activeElement` 是 `IFRAME`。
- deck 自己在 `resize` 时会重跑一次 `show(i)`，页号不变也照报一次。宿主按"和当前页相同的页号不算新的一次停留"丢掉（`withSlideEvent`），否则拖一次窗口就在记录里多一段假的停留。
