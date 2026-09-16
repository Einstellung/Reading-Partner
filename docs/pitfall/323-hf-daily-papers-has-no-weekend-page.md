# HF daily_papers 按 date 查周末返回空数组

## 现象

2026-09-13（周日）实测：`GET https://huggingface.co/api/daily_papers?date=2026-09-12`（周六）返回 HTTP 200，正文 `[]`。同一时刻 `date=2026-09-11`（周五）返回整页，不带 `date` 返回最新一页。空数组和"没有新论文"长得一样，源健康也是绿的。

## 原因

Daily Papers 是人工策划的工作日页面，周末没有页。`date` 参数按日精确匹配，不会回退到最近一页；不带 `date` 才是"最新一页"。

## 解法

huggingface provider 的 `days` 循环把空页当正常页跳过，不报错。要让周末的轮询也有东西，查询里 `days` 给 3 而不是默认的 1：周日跑到周五那页，一天一个请求。不要为了周末改成不带 `date` 的请求——`days>1` 需要按日翻页，两种语义混在一起说不清"今天"是哪天。

顺带两条同一次实测记下的形状：`api/models` 的行没有 description，只有 `pipeline_tag`、`library_name`、`tags`；`api/datasets` 的行有截断的 `description`（结尾是 "See the full description on the dataset page"），任务和库藏在 `task_categories:` 和 `library:` 前缀的 tag 里，没有 `pipeline_tag`。
