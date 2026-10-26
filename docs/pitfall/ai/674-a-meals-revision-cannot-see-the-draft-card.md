# 改饮食草稿的回合看不到草稿卡

## 现象

Linux 上用真 ChatGPT（gpt-6.1-sol，high）回放：第一个回合出了草稿卡，接着说「第二天的晚饭不想吃鸡肉，换一个」。模型没调 `propose_meal_plan`，搜了两次对话，然后回「上一条说已生成卡片不准确，抱歉」，让用户发截图。卡就在屏幕上。

## 原因

对话回放只带文字（`turn-rows.ts` 的 `replayableHistory` 滤掉没字的行），卡片行没字，上一回合的工具调用和结果也不回放。第二个回合里模型只看得到自己那句「计划在上面的卡片里」，看不到卡上排了什么，搜对话也搜不到。说明里写着「改的时候交整份新草稿」，模型没有可改的底稿。

## 解法

卡还没确认时，三餐桌把卡上那版的主菜、锅和备餐按 `propose_meal_plan` 的参数形状写进说明（`tools.ts` 的 `draftOnCard`）。草稿卡由界面持有，`use-info-call.ts` 把 `currentDraft` 作为 `mealsDraft` 交给 `assembleInfoTurn`，绑在三餐的 desk ref 上（`desk/bind.ts` 的 `bindItemRef`），开桌时读一次。早餐、主食、配菜、水果不附，程序重补。语音和无人看的回合没有卡，不附。
