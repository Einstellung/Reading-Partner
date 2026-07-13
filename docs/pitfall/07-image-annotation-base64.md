# image 标注内联截图导致 JSON 膨胀

> 2026-07-13：区域框选功能整个移除（用户不用矩形批注），本坑的拆盘机制随之删除。保留本文供历史参考；若将来恢复 image 标注，先读这里。

现象：区域框选（image 工具）产出的标注对象里有个 `image` 字段，值是整块区域的 PNG base64 data URI。一块约 110x71pt 的区域 ~79KB。

影响：标注按 JSON 文件落盘时，几十个圈选就是几 MB，读写变慢。

实测补充（M3）：引擎在文档里渲染 image 标注只按 position 画矩形框，不用 image 字段——同一条标注带/不带 image 两次加载，文档渲染完全一致。image 字段只服务侧栏/痕迹列表的缩略图。

解法（M3 已做）：保存时把 image（base64）写成 AppData/images/<pathHash>/<annotationId>.png，JSON 里删掉该字段；痕迹列表要缩略图时按需读回。喂回 createView 时不需要补。删除标注时会留孤儿 PNG（capability 未授 remove，无害），将来清理时再加权限。
