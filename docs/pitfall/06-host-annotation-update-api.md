# 宿主改/删标注的正确 API

现象：宿主要更新一条标注（换色、改 comment），引擎有好几个长得像的方法，选错会有副作用。

结论（实测）：

- 更新用 `view.setAnnotations([完整对象])`——按 id upsert，且不会回触 onSaveAnnotations，不自环。
- 删除用 `view.unsetAnnotations([ids])`。
- 宿主自己的落盘要同步做，引擎不管持久化。
