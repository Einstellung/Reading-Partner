# topic 进 info

## 愿景

视野就是 topic，一个实体，不是 statement 的一种也不是 info 自己的配置。cable 在 `saved` / `promoted` / `folded` 三个出口带上 topic，由 AI 提议、用户点头，确认卡是 [21](../21-info收藏与reading打通.md) 已定的那张。见 [61](../61-palace与desk.md)「定下的」。

## 为什么现在不做

61 定的顺序是先 desk 后 topic 进 info。desk 那半落了，这半还没排；`BRIEF_TOPIC_ID = "brief"` 的应急版够用。

## 将来做时已知的事实

- 已有的只有 `propose_topic` 确认卡和 thread 带 `topicId`。
- `src/info/cable/types.ts` 的 `Cable` 没有 topic 字段；`saved` / `promoted` / `folded` 三个出口在 src 里零命中。
- 位子留好了一个：`src/info/labs/types.ts` 的 `Charter.topicId`，注释写着 Unused this release，是研究室出的稿将来归到哪个 topic。
- 61 的另外几步已落地：Red Box 生在 palace（`src/box/`，一项一文件，盒本身不存，开没开从项的状态读）；`deleteTopic` 是 palace 驱动的级联（`src/palace/index.ts` 的 `cascadeOfTopic`、`src/reading/delete/delete-topic.ts`）。
- 61「定下的」还有一条没做：跨桌的原始对话可以直接检索，范围先按 topic，topic 内没命中再扩大。
