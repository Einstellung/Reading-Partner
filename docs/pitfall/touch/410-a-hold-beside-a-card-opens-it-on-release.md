# 卡片旁边长按，松手照样打开卡片

## 现象

手机长按删除的原型在 iPhone 模拟器上：手指落在两张卡片之间的空白（或卡片边缘外一点）按住半秒以上，菜单没出来（按下点不在卡片上，长按从没开始计时），松手却打开了旁边那张卡片。同一轮还看到：落在非卡片区域的长按起了系统选区和 callout。

## 原因

WebKit 在 iOS 上会把一次没有移动的触摸吸附到附近可点的元素上再派 click（胖手指的目标修正），不管按了多久。长按的判定只看 pointerdown 落在哪个元素上，click 的目标却是吸附后的那个，两者不一致。选区和 callout 是因为外壳里那片区域的 `user-select` 还是默认值。

## 解法

`phone/hold-menu.ts` 的 `stepClickGuard`：记下每次 pointerdown 的时间，一个 click 落在可长按的元素上、而且距按下已经过了长按时长（500ms），就吞掉；长按真的触发过的那一次 click 也吞掉。判定在捕获阶段挂在整个面板上（`phone/use-hold.ts`），不挂在卡片上。书架、Saved 列表的根节点加 `select-none [-webkit-touch-callout:none]`，输入框在 Portal 出去的 sheet 里不受影响；课堂的 aside 行走 `styles.css` 里 `[data-lesson-press] [data-aside-id]` 那条。
