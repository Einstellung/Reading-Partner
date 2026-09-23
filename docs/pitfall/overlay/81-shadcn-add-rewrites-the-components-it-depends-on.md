# `shadcn add` 会顺手重写它依赖的组件，包括手改过的那些

## 现象

`bunx shadcn@latest add alert-dialog` 的输出：

```
✔ Created 1 file:
  - src/ui/components/ui/alert-dialog.tsx
ℹ Updated 1 file:
  - src/ui/components/ui/button.tsx
```

`button.tsx` 是第一版按项目现有 122 个按钮归类手写的变体表，被换成了 shadcn 的默认那份：紫色没了，`coarse:` 的 44px 没了，`can-hover:` 没了。命令没问过，"Updated" 这一行混在正常输出里。

## 原因

registry 里 `alert-dialog` 把 `button` 列为依赖，`AlertDialogAction` / `AlertDialogCancel` 现在是拿 `Button` 渲染的。add 一个组件会把它的依赖一起写下来，已经存在的照写不误。

同族：它还会往 `package.json` 里加依赖（这次是 `radix-ui` 伞包），也不问。

## 解法

add 完先看 `git status`，把不该动的找回来：

```
git checkout src/ui/components/ui/button.tsx
```

再决定新组件怎么接。`--overwrite` 不影响这个行为，去掉它只会让新文件也写不进去。
