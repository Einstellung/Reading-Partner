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

用这个常量就必须自己带列数。要和书架一致就拼 `TOPIC_GRID_COLUMNS_CLASS`，是另一种排布就自己写 `grid-cols-*`。
