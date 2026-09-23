# `LIBRARY_GRID` 里没有列数，光靠它拼出来的网格会摊成一列

## 现象

搭一个静态页复现书架，照 `LibraryScreen` 的样子写：

```tsx
<ul className={LIBRARY_GRID}>
  {topics.map((t) => <TopicCard key={t.id} topic={t} … />)}
</ul>
```

出来不是网格：第一张卡横跨整个宽度，封面被拉成一大块色块，后面的卡一张一行。改成 `<ul>`（`TopicCard` 渲染的是 `<li>`）没有用。

## 原因

`LIBRARY_GRID` 只有 `grid list-none m-0 p-0 gap-x-4 gap-y-6`，一个 `grid-cols-*` 都没有。列数写在两个调用点上，各写各的：

- `LibraryScreen.tsx` 拼 `` const GRID = `${LIBRARY_GRID} ${TOPIC_GRID_COLUMNS_CLASS}` ``，断点表在 `shelf/topic-shelf.ts`；
- `Vestibule.tsx` 的 Today 用 `` `${LIBRARY_GRID} mt-3 grid-cols-3 lg:grid-cols-5` ``，因为那一排只有一行，断点跟书架不是一回事。

没有列数的 `display: grid` 就是单列，而卡片本身是 `w-full`，所以看起来像布局炸了而不是像少了一个 class。

## 解法

用这个常量就必须自己带列数。要和书架一致就拼 `TOPIC_GRID_COLUMNS_CLASS`，是另一种排布就自己写 `grid-cols-*`。「换成 `LIBRARY_GRID` 就正常了」这句话本身会让人以为这个常量自带列数——它不带，正常的原因永远是列数类跟着一起拼上了。

## 同一个坑的另一张脸：探针页在 `src/` 外，现写的列数类不生效

无头截图用的静态探针页如果放在 `src/` 之外，还会撞上另一层：Tailwind v4 只生成它在扫描目标里见过的 class，这个仓库扫的是 `src/`，探针页里现写的 `grid-cols-4` 不在任何 `src/` 文件里出现过，`dist/assets/index-*.css` 里就没有这条规则。浏览器拿到一个不存在的 class 不报错，`display:grid` 生效、列数没设，于是变成一列，卡片被拉满宽——和上面「忘拼列数类」长得一模一样，但这次代码里明明写了 `grid-cols-4`。

探针页只用两种 class：组件自己带的，和从组件文件里导出的常量（`LIBRARY_GRID`、`TOPIC_GRID_COLUMNS_CLASS` 这些）。要自己搭壳就用 inline `style`，别现写 utility class。写完先在图里找一处只可能来自那条 class 的效果，确认它真的生效。
