# 做饭类 agent skill 与菜谱知识资产调研

> 2026-09-22。调研级文档，不是设计共识。每条链接都实际打开过，打不开的写明。
>
> 上游：[饮食规划调研](./饮食规划调研.md)（2026-08-28）已经查过菜谱和营养数据源那一层，HowToCook、USDA FoodData Central、Open Food Facts 的许可证结论和本文一致。它当时的形态结论是"菜谱不内置库、走用户贴链接抽 schema.org JSON-LD 加模型按约束生成"，本文第六节列的几条内置候选和那条结论相反，需要一起看。[食材与菜品图片源调研](./食材与菜品图片源调研.md) 覆盖图片那一层，本文不重复。

现成的东西分三类。一类是提示词式的 skill：SKILL.md 里写的是流程（先问几口人再搜菜谱再拼单子）和几条启发式（工作日 30 分钟内、周末批量做），几乎不带菜谱数据，也不带份量。一类是工具包：把菜谱库做成 MCP server 或 CLI，模型只负责调用，排菜和合并单子的逻辑写在代码里。第三类是纯数据：菜谱库、保质期表、食材营养表，许可证从公共领域到"仅限研究"都有。没有找到任何一份把"怎么排一周三餐"当作领域知识写透的 skill——排法几乎都是"搜到什么放什么"，唯一写出排菜规则的是 HowToCook 的一篇 tips 和 HowToCook-mcp 的代码。

## 一、Agent Skills（SKILL.md）格式

### cooklang/cooklang-skills

https://github.com/cooklang/cooklang-skills 。MIT，7 star，10 个 skill 的 plugin 包（`.claude-plugin/marketplace.json`）。skill 全是 CookCLI 的壳：`meal-plan`、`shopping-list`、`scale-recipe`、`manage-pantry`、`search-recipes`、`create-recipe`、`convert-recipe`、`validate-recipes`、`organize-collection`、`export-recipe`。

写进去的知识：

- 流程。`meal-plan` 五步：问需求（几人、几天、忌口、排哪几顿）→ 搜菜谱（"emphasizing variety and ingredient overlap"）→ 按天铺成表格 → 调 `cook shopping-list` 生成单子 → 导出。
- 启发式，只有一条半。工作日 "Quick meals (< 30 min)" 和 "One-pot dishes"，周末 "Longer cook times"、"Batch cooking for week"。
- 缩放表。`scale-recipe` 写明什么不线性缩放：主料和液体线性；调味料 "Partially"，`@salt{=1%tsp}` 的 `=` 标记表示固定不缩放；烹饪时间 "No"（"larger batches may need more"）；锅具尺寸 "No"（要分批）。"Baking is more sensitive to scaling than cooking."
- 采购单归并。靠 `cook shopping-list Recipe.cook:2` 这样的 CLI，分组读 `aisle.conf`（TOML，`[produce]` / `[dairy]` / `[meat]` 下列食材名），已有的读 `pantry.conf` 排除。
- 保质期。`manage-pantry` 把库存分 `[pantry]` / `[fridge]` / `[freezer]`，每项可带 `milk = { quantity = "1L", expire = "2026-01-28" }`，命令 `cook pantry expiring --days 7`。过期日期是用户填的，不是内置的食材保质期表。

结构：单个 SKILL.md，无参考文件无脚本，全部能力外包给 `cook` 命令。

和 docs/73 的对照：采购单归并和"已有的不买"我们有（`deriveShoppingList` + `ShoppingState`），它靠外部 CLI。缩放表我们没有，但我们也不缩放（份量文本 ` + ` 接起来）。冲突点：它把排菜做成"问完需求现搜菜谱"，我们是模型直接交菜。

### dmorrill/cooking-with-claude

https://github.com/dmorrill/cooking-with-claude 。GPL-3.0，23 star，v2.1.0。不是 skill 包，是一整个 Claude Code 仓库模板：CLAUDE.md + 50 多份菜谱 markdown + 分楼层的库存文件（`inventory/upstairs/freezer.md` 等）+ 模板 + 一个本地 MCP（`cooking-mcp/src/meal-planner.js`）。

写进去的知识：

- 排菜启发式，在 CLAUDE.md 里，就三句："Balance nutrition across the week. Use up perishables before non-perishables. Consider prep time for busy vs. relaxed days."
- 提前做的保质期常识（这是我们最缺的那类）："Sauces and dressings: most last 5-7 days"、"Marinated proteins: 12-24 hours ideal"、"Chopped vegetables: 1-3 days, varies by type"、"Cooked grains/legumes: 3-5 days"。
- 一周模板 `templates/weekly-meal-plan-template.md`：七天各一张 Meal/Recipe/Prep Notes 表，底下 "Sunday Prep List"、按 Produce/Pantry/Refrigerated/Frozen 分区的采购单、以及一张 "Leftovers Plan" 表（From / Enough for / Eat by）。
- 偏好文件 `meal-planning-preferences.md`：分"当前要多吃的食材（带勾选框）"、"要少吃的"、"最近已吃过（轮换用）"三段，底下一节 "For Claude" 直接写给模型："Check this file when planning meals"、"Move checked items to 'Recently Incorporated' after use"。食材轮换是靠这份文件实现的。
- `templates/prep-and-assemble-workflow.md`：两个人分工做饭，备料的人把食材按"什么时候用"分装进编号容器，做的人只照编号来。很长，带日历事件模板和 emoji 排版。

结构：CLAUDE.md 当入口，其余全是被引用的 markdown 文件，渐进披露靠"需要时再读那份文件"。

和 docs/73 的对照：Leftovers Plan 表和我们的 `base` / `fresh` / `reheatOf` 是同一件事的两种写法，它只到"能吃几顿、几号前吃掉"，没到"底和现加的分开"。偏好轮换文件我们没有对应物（章程是静态的）。冲突：它按卡路里/营养目标排（`meal-planning-preferences.md` 有 Nutritional Goals 段），我们这一片禁止出现营养数字。

### 个人 dotfiles 里的 cooking skill

https://skills.lc/stephendolan/dotfiles/stephendolan-dotfiles-ai-skills-cooking-skill-md 。skills.lc 索引站，站点本身 MIT，这份 skill 未标许可证。内容是一个人的厨房现状：三口之家、设备清单（空气炸锅优先于烤箱）、自家菜园在 Georgia 7b 区、三只鸡供蛋、固体用克液体用英制、替换规则（"Seed oils → olive oil or coconut oil; Refined sugar → honey, maple syrup, or coconut sugar"）、菜谱按 Breakfast/Dinner/Desserts/Sides/Sauces 分目录、用 Cooklang 存。

值得看的是它的形态：这份 skill 几乎全是"这个家的事实"，做饭知识只有替换规则那几条。我们的章程（`MealsCharter`）覆盖了其中大半，缺的是设备清单的细度（具体到型号和偏好顺序）和替换规则。

### anthropics/skills

https://github.com/anthropics/skills 。官方仓库，大部分 Apache-2.0，文档类 skill 是 source-available。没有任何做饭、食物、菜谱相关的 skill。

### 目录站

skills.sh 的分类里没有 cooking / food 一类，搜 cooking 返回空（https://www.skills.sh/?q=cooking ）。agentskills.io 是 SKILL.md 开放标准的规范站，不是 skill 市场。mcpmarket 上有一个 "AI Recipe & Meal Planner"（https://mcpmarket.com/tools/skills/ai-recipe-meal-planner ，作者 GaitanS），定位是"把营养优化工具算出来的食物清单转成菜谱"，要配合它自己的 llmn 工具用，页面不给许可证，SKILL.md 正文未公开。

## 二、其他生态

### OpenClaw / ClawHub

openclawai.io/skills/food 列了 25 个 food 类 skill。和我们这条线沾边的：

- Weekly Menu 每周菜单（beginnerrudy）——生成周菜单加采购单，中文。
- feast（smadgerano）——每周指定一个地区做主题，菜谱"researched from native sources"，每天按时揭晓当天的菜加一份地区歌单，采购单跨店比价。
- meal-suggester（thibautrey）——25 分钟内的晚饭，读 `inventory/stock.md` 和两份 `preferences/userN.md` 口味档案，做完记录消耗，按历史轮换。clawskills.sh 页面标注 VirusTotal 和 OpenClaw 都判为 Suspicious。
- Mealie / Tandoor 的 API 壳各一个。

skill 正文我没能拿到：`github.com/openclaw/skills` 以及它下面的 `skills/okikesolutions/plan2meal/SKILL.md`、`skills/jeffaf/recipes/SKILL.md`、`skills/smadgerano/feast/SKILL.md` 全部 404（搜索索引里有，仓库现在打不开），`clawskills.sh/skills/beginnerrudy-weekly-menu` 也 404。上面的描述来自 clawskills.sh 和 openclawai.io 的目录页，不是原文。许可证一律未标。

### GPT 商店

能看到 instructions 的只有泄露仓库里的转录。friuns2/Leaked-GPTs 的索引里有 "Meal Mate"（"The Ultimate Meal Planning Assistant... Plan Around Dietary Restrictions, Budgetary Constraints, Nutritional Goals, Taste Preferences"），但具体文件 `gpts/Meal Mate.md` 404，未能打开正文。这一类即使拿到也是来路不明的转录，不能内置。

LangChain / CrewAI / Hugging Face 上的 meal planning agent 没查（见末尾"没查完的"）。

## 三、中文社区

### Anduin2017/HowToCook

https://github.com/Anduin2017/HowToCook 。Unlicense（"This is free and unencumbered software released into the public domain."），102.3k star，2632 commit，活跃。这是这次调研里唯一一份量级够、许可证干净、且写了份量的中文菜谱库。

`dishes/` 下按 `meat_dish` / `vegetable_dish` / `aquatic` / `breakfast` / `staple` / `soup` / `drink` / `dessert` / `condiment` / `semi-finished` 分目录，一菜一目录一 markdown。以 `dishes/meat_dish/宫保鸡丁/宫保鸡丁.md` 为例，固定五段：

- 开头一段：味型描述、"预估烹饪难度：★★★★"、"预估卡路里：1790大卡"、总耗时。
- `## 必备原料和工具`，再加 `### 可选原料`。
- `## 计算`：份数基准（"本菜谱为一人版本，两人份量也够食用。多人烹饪可按比例增加材料"）加逐项克数，分"必须配料 / 进阶配料 / 可选配料"三档。例："手枪腿（或鸡胸脯肉）= 1支（约350g）"、"生抽酱油 = 10g"。
- `## 操作`：编号步骤，常分"简易版本"和"进阶版本"两套。步骤里带时间和克数（"中小火焖2分钟"、"淀粉10克加50克清水调成水淀粉"）。
- `## 附加内容`。

`tips/` 是散的做饭知识：`厨房准备.md`、`如何洗碗.md`、`如何选择现在吃什么.md`，`tips/learn/` 下 11 篇技法（去腥、凉拌、炒与煎、焯水、煮、腌、蒸、微波炉、空气炸锅、食品安全、高压力锅），`tips/advanced/` 另有一组。

`tips/如何选择现在吃什么.md` 是这次调研里唯一一份成文的排菜规则：总菜数 = 人数 + 1；荤菜比素菜多一个或相等，`a = Math.floor((N+1)/2)` 素、`b = Math.ceil((N+1)/2)` 荤；八人以上加一道鱼；有小孩加一道甜口；肉类不要只用一种，按猪鸡牛羊鸭鱼的顺序优先；不用稀奇的肉。

和 docs/73 的对照：`## 计算` 那一段正好是 `Dish.ingredients` 缺的东西——按份数给的克数，而且分必须/进阶/可选三档。`## 操作` 的粒度和我们 `ensureDishMethod` 要的 1–10 步、每步 ≤200 字基本吻合（它常超 10 步，且分两个版本）。冲突两处：它每道菜写卡路里，我们这一片禁止出现营养数字；它按"人数+1 道菜、荤多于素"排，我们是一天三顿、一顿一道菜加一口锅。

### HowToCook-mcp

https://github.com/worryzyy/HowToCook-mcp 。MIT，773 star，npm `howtocook-mcp`，另有 DXT 一键装 Claude Desktop。五个工具：`get_all_recipes`、`get_recipes_by_category`、`get_recipe_details`、`recommend_weekly_menu`（参数 `allergies`、`avoidItems`、`peopleCount` 1–10）、`get_random_menu`。

排菜逻辑写在代码里（`src/tools/recommendMeals.ts`）：午晚饭从 `['主食', '水产', '荤菜', '素菜', '甜品']` 里随机取，荤素没有固定比例；工作日每顿 `Math.max(2, Math.ceil(peopleCount / 3))` 道菜，周末"比工作日多1-2个菜"（≤4 人多 1，更多人多 2）。采购单那半：累计每种食材的数量、单位、出现次数和用到它的菜，"对食材按使用频率排序"，再 `categorizeIngredients()` 分成 fresh / pantry / spices / others。

README 没写菜谱数据怎么打包（未能确认是否内置 JSON）。同源的 https://github.com/HZZY2019/Cook-MCP 是同一套东西的另一个实现，MIT，0 star。搜索结果提到另有 npm 包 `how-to-cook`（1.5.0，101 MB）把 HowToCook 的 markdown 解析成结构化 JSON，含 schema.org Recipe JSON-LD、难度和卡路里解析、烹饪方式关键词归类、无法结构化的配料保留原文，并支持拼音模糊搜索——npmjs 页面 403 未能打开，这些字段是搜索摘要转述的，用之前要自己扒包验。

### 下厨房 / XiaChuFang Recipe Corpus

https://counterfactual-recipe-generation.github.io/dataset_en.html 。1,520,327 条中文菜谱，其中 1,242,206 条归属 30,060 道菜（平均一道菜 41.3 个版本），平均长度 224 字，415,272 位作者，截至 2020 年 12 月。OpenDataLab 和 HyperAI 有镜像。学术数据集，来源是下厨房网站的用户内容，页面未见明确的商用许可；规模也不适合内置（未压缩远超 app 体积预算）。当语料看可以，当内置数据不行。

## 四、开源菜谱 / 备餐软件的知识结构

### Mealie

https://mealie.io/documentation/getting-started/features/ ，AGPL-3.0。

- 菜谱组织：Categories（Breakfast / Lunch / Dinner 这类主分类）、Tags、Tools（设备），Cookbooks 是"存起来的搜索"，按 Categories + Tags + Tools 的交集过滤。
- 食材是一等实体。Foods 和 Units 在 Group 级别管理、可预置导入，食材挂 Food Label，菜谱可以"filtered by their ingredients, either by a specific food or by the Food Label a food belongs to"。数据维护里有 "Merge Foods into a single food entry" 和 "Merge Units into a single unit entry"——同物异名的归并是显式的一步，不是靠字符串相等。
- 排菜靠 Planner Rules：规则"restrict the pool of recipes based on the Tags and/or Categories of a recipe, or on its ingredients"，可以按顿（Breakfast/Lunch/Dinner/Snack）和星期几分别设。约束是用户写的规则，不是内置知识。
- 采购单挂在菜谱上，加菜就把它的全部配料加进单子，行上挂 Label 分组。

对照 docs/73：Food Label 到采购单分组，和我们的固定 `category` 枚举是同一个机制，区别是它的映射表由用户维护、可合并同义词；我们的 `en` 别名表（`images.ts`）已经在做同义词归并，但只为了取图，没有反过来用于合并采购单的行。Planner Rules 我们不做（章程加提示词代替）。

### Tandoor

https://tandoor.dev/ ，AGPL-3.0（有关于附加 Commons Clause 限制的争议）。Django + Vue + PostgreSQL。它把"数量-单位-食材"建成三元关系，改份数后自动换算所有配料，不用手动重算。采购单支持按货架（aisle）排序和实时同步，比 Mealie 可配，但 aisle 分组要自己先配好。功能面最全，带营养和成本。

### Grocy

https://grocy.info/ 。它的产品模型里有三个和保质期直接相关的字段：`default best before days`（买入时预填保质期，-1 表示永不过期）、`default best before days after opened`（开封后能吃几天）、`default best before days after freezing`（从冷藏挪进冷冻后重算的保质期）。这是"开封前 / 开封后 / 冷冻"三态保质期的现成建模，比我们 `keeps` 的单一枚举细一档。数据本身要用户自己填。

Plan to Eat 是闭源商业产品，没有可看的知识结构，未查。

## 五、数据源

- TheMealDB（https://www.themealdb.com/api.php ）。"The API and site will always remain free at point of access." 开发和教学可以用测试 key `1`，但"must become a supporter if releasing publicly on an appstore"。免费档单次返回上限 100 条，全库列出要 supporter。我们已经在用它的配料白底图（992 个名字全量内置在 `mealdb-ingredients.ts`），docs/73 里已记了上架前要买 supporter 这件事。
- FSIS FoodKeeper（https://catalog.data.gov/dataset/fsis-foodkeeper-data ）。美国农业部食品安全检验局的食物储存期数据，400 多个食品条目，分常温 / 冷藏 / 冷冻三种储存方式给时长，英西葡三语，XLS 和 JSON 两种格式，明确标 CC0 1.0 公共领域。体积很小，可以整份内置。品类偏美式，中餐食材（莲藕、菜心、金针菇之类）覆盖不到。
- USDA FoodData Central（https://fdc.nal.usda.gov/data-documentation/ ）。公共领域 / CC0，几十万条食物成分数据。我们这一片禁止营养数字，只有"食材标准名"那一层有用，而且是英文。
- Open Food Facts（https://world.openfoodfacts.org/data ）。ODbL 1.0，要署名且有 share-alike。全库 dump 提供 JSON / CSV / SQLite。是包装食品条码库，不是菜谱库；ODbL 的 share-alike 和本仓库的 PolyForm Strict 要一起看才知道冲不冲突。
- Spoonacular / Edamam。商业 API，按调用计费，不能离线内置。我们只用了 Spoonacular 的几个图片 CDN 常量 slug 兜底。
- RecipeNLG（https://recipenlg.cs.put.poznan.pl/dataset ）和它的上游 Recipe1M+。200 多万条英文菜谱。许可证限"非商业研究和教育用途"，要先签同意书才能下。不能用。
- XiaChuFang Recipe Corpus。见上，152 万条中文，学术用途，不能内置。

## 六、可以拿走的

只列，不排序，不做决定。

1. HowToCook 的 `## 计算` 段式：份数基准 + 逐配料克数 + 必须/进阶/可选三档。Unlicense，公共领域，抄格式或抄数据都没有许可证问题。落点是 `Dish.ingredients` 和 `mealsGuidance` 里"List a dish's ingredients for every serving"那几行。

2. HowToCook 的菜谱正文本身，几百道中餐，每道带克数和分步做法。Unlicense。可以整份内置成一个离线菜谱库供 `ensureDishMethod` 检索，也可以只当模型的参考样例。它的"简易/进阶"双版本和卡路里那行要剥掉（docs/73 禁止营养数字）。

3. `tips/如何选择现在吃什么.md` 的排菜算式（菜数 = 人数 + 1，荤素各半、荤多一）和 `tips/learn/` 的 11 篇技法。Unlicense。落点是提示词里"HOW TO PLAN"那一段，或者做成按需读的参考文件。注意它是"一桌几道菜"的家宴口径，和我们"一顿一道菜、一口锅"冲突，拿的是形式不是数值。

4. FSIS FoodKeeper 的保质期表，400 多项、CC0、体积小。落点是 `Ingredient.keeps` ——今天 `keeps` 由模型从枚举里选，有这张表就能程序判定一部分，符合 docs/73"事实不经模型"那条。中餐食材覆盖不到，要自己补。

5. cooklang-skills 的缩放不变量表：主料线性、调味料部分缩放、时间和锅具不缩放、烘焙更敏感。MIT。落点是采购单合并份量那段，以及将来做"这周两个人吃"时的份量文本。

6. cooking-with-claude 的提前做保质期常识（酱汁 5-7 天、腌好的肉 12-24 小时、切好的菜 1-3 天、煮好的谷物豆类 3-5 天）。GPL-3.0——照抄文字会传染，把它当事实核对表重写成自己的话则不受影响。落点是 `Dish.keepsADay` 的判据，今天这个布尔值全凭模型。

7. cooking-with-claude 的偏好轮换文件形态：要多吃的 / 要少吃的 / 最近已吃过三段，模型排菜前读、用完把条目挪进"最近已吃过"。落点是章程之外的一份可变状态，对应 docs/73 里"腻了、太麻烦留到下次排"那句今天没有落盘的地方。

8. Mealie 的 Food 合并机制：同物异名显式合并成一个 food 实体，food 挂 label，label 决定采购单分组。AGPL-3.0，只拿设计不拿代码。落点是 `deriveShoppingList` 的"同名同类合并"——今天按名字相等合并，`en` 别名表只用于取图，可以反过来当合并键。

## 没查完的

- LangChain / CrewAI 官方示例里的 meal planning agent，Hugging Face 上的同类 Space 和数据集，完全没查。
- OpenClaw 的 skill 正文全部没拿到（仓库 404），只有目录页的描述。
- `how-to-cook` npm 包（HowToCook 的结构化 JSON 导出）的真实字段没验（npmjs 403），只有搜索摘要。
- Tandoor 的数据库模型细节（Food / Unit / Supermarket Category 的表结构）只看了官网功能页，没读源码。
- 中文的结构化菜谱数据集除下厨房语料外没有再找。
