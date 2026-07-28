# WebKit 点击不给按钮焦点，靠 blur 收起的二次确认按钮按了等于没按

## 现象

iPad 上，Reading with AI 气泡头部点垃圾桶，图标变成红色 Confirm delete；再点 Confirm delete，对话不删，按钮还停在 Confirm delete 上，看不出任何反应。桌面端同一个按钮正常。

## 原因

WebKit 点击 `<button>` 不给它焦点，只有接受文本输入的控件才在点击时获得焦点。`DeleteThreadButton` 武装后用 `.focus()` 把焦点放到确认按钮上，再靠 `onBlur` 收起武装状态。第二次点击时 WebKit 在 mousedown 阶段把焦点从按钮上撤走，`blur` 先于 `click` 到达，`setArmed(false)` 立刻重渲染。

两个分支返回的都是 `<button>`，同类型同位置，React 复用同一个 DOM 节点，只换掉 className、文字和 onClick。等 click 真正派发到这个节点时，上面挂的已经是"武装"那个 handler。一次点击的净效果是先解除武装再重新武装：删除不执行，外观也不变。

## 解法

二次确认的收起不要挂在焦点上。武装期间在 document 上挂 capture 阶段的 `pointerdown`，落点不在按钮内才收起，另加 Escape：

```tsx
useEffect(() => {
  if (!armed) return;
  function onPointerDown(e: PointerEvent) {
    if (!confirmRef.current?.contains(e.target as Node)) setArmed(false);
  }
  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}, [armed]);
```

焦点还是给确认按钮，键盘可以直接回车确认，但不再有行为挂在焦点上。

同族的另一个后果：没有程序化 `.focus()` 的控件在触摸端根本拿不到焦点，`onBlur` 从不触发。`SourcesPage` 的 HealthDot 就是这样，小浮层在 iPad 上只能靠再点一次圆点关掉，点别处关不掉。
