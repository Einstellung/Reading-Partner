// The spoken-briefing normalizer (docs/33). Every case here is a form taken
// from a real briefing (src/info/briefing writes them; the two on disk when this
// was written were 2026-07-21 in English and 2026-08-12 in Chinese), or one of
// the five readings docs/33 names by hand.

import { expect, test } from "bun:test";
import { chineseInteger, normalizeForSpeech } from "../../src/info/briefing/speech/normalize";

// --- the five readings docs/33 names --------------------------------------

test("a date is read as a Chinese date", () => {
  expect(normalizeForSpeech("2026-08-09")).toBe("二〇二六年八月九日");
  expect(normalizeForSpeech("2026/08/09")).toBe("二〇二六年八月九日");
  expect(normalizeForSpeech("生成于 2026-08-12。")).toBe("生成于二〇二六年八月十二日。");
});

test("a year-month with no day keeps the month", () => {
  expect(normalizeForSpeech("2026-08")).toBe("二〇二六年八月");
});

test("a version number is spelled and then read", () => {
  expect(normalizeForSpeech("GPT-5")).toBe("G P T 五");
  expect(normalizeForSpeech("GPT-4.1")).toBe("G P T 四点一");
});

test("an unknown all-caps run is spelled letter by letter", () => {
  expect(normalizeForSpeech("周三 CPI 是关键")).toBe("周三 C P I 是关键");
  expect(normalizeForSpeech("Agentic RL 资源调度")).toBe("Agentic R L 资源调度");
});

test("a known acronym comes from the table instead", () => {
  expect(normalizeForSpeech("含 SOTA")).toBe("含 sota");
  expect(normalizeForSpeech("MoE 扩展定律")).toBe("混合专家扩展定律");
  expect(normalizeForSpeech("arXiv 上的预印本")).toBe("archive 上的预印本");
});

test("a URL becomes its domain body, never its path", () => {
  expect(normalizeForSpeech("见 https://www.jiqizhixin.com/articles/2026-08-12-8")).toBe(
    "见 jiqizhixin 链接",
  );
  // The body goes through the reading table too, so a domain that is an
  // acronym is said as one.
  expect(normalizeForSpeech("https://spectrum.ieee.org/recycling-robot")).toBe("I 三 E 链接");
  expect(normalizeForSpeech("simonwillison.net/2026/Aug/11/stealing/#atom")).toBe("simonwillison 链接");
  expect(normalizeForSpeech("https://192.168.1.4/x")).toBe("链接");
});

test("a year is read digit by digit and a count by its places", () => {
  expect(normalizeForSpeech("2021 年 3 月")).toBe("二〇二一年三月");
  expect(normalizeForSpeech("过去 37 年")).toBe("过去三十七年");
  expect(normalizeForSpeech("ICML 2026 paper")).toBe("I C M L 二〇二六 paper");
  // A measure word right after says it was a count, not a year.
  expect(normalizeForSpeech("2000 个任务")).toBe("两千个任务");
});

test("a quantity is read by its places", () => {
  expect(normalizeForSpeech("同算力 343 万")).toBe("同算力三百四十三万");
  expect(normalizeForSpeech("140 个真实研究任务")).toBe("一百四十个真实研究任务");
  expect(normalizeForSpeech("核心代码不到 10 行")).toBe("核心代码不到十行");
});

// --- what the real briefings turned out to contain ------------------------

test("a percent is said before its number, with the sign as a word", () => {
  expect(normalizeForSpeech("显存降 73%")).toBe("显存降百分之七十三");
  expect(normalizeForSpeech("环比 +0.1%")).toBe("环比正百分之零点一");
  expect(normalizeForSpeech("前值意外 -0.4%")).toBe("前值意外负百分之零点四");
});

test("an arrow between two numbers is said", () => {
  expect(normalizeForSpeech("成功率 79.75%→85.08%")).toBe(
    "成功率百分之七十九点七五到百分之八十五点零八",
  );
  expect(normalizeForSpeech("1K→32K")).toBe("一 K 到三十二 K");
});

test("a digit range is said as a range", () => {
  expect(normalizeForSpeech("down to 3-5 months")).toBe("down to 三到五 months");
});

test("a fraction is said the Chinese way round", () => {
  expect(normalizeForSpeech("达标时间缩到 1/2.5")).toBe("达标时间缩到二点五分之一");
});

test("a slash between alternatives becomes a pause", () => {
  expect(normalizeForSpeech("Anthropic/OpenAI/Google")).toBe("Anthropic、OpenAI、Google");
  expect(normalizeForSpeech("模型/推理话题")).toBe("模型、推理话题");
  expect(normalizeForSpeech("depth/3D-reconstruction")).toBe("depth、三 D reconstruction");
});

test("a hyphen is a pause between Chinese words and a joint everywhere else", () => {
  expect(normalizeForSpeech("驱逐-卸载-预取闭环")).toBe("驱逐、卸载、预取闭环");
  expect(normalizeForSpeech("Agent-引擎接口")).toBe("Agent 引擎接口");
  expect(normalizeForSpeech("Cross-Batch 版本")).toBe("Cross Batch 版本");
  expect(normalizeForSpeech("MLS-Bench")).toBe("M L S Bench");
});

test("a model name splits at the letter/digit joint", () => {
  expect(normalizeForSpeech("48 张 A800")).toBe("四十八张 A 八百");
  expect(normalizeForSpeech("30B-A3B")).toBe("三十 B A 三 B");
  expect(normalizeForSpeech("Qwen3 同规模")).toBe("千问三同规模");
});

test("a unit is read as a word", () => {
  expect(normalizeForSpeech("300ms")).toBe("三百毫秒");
  expect(normalizeForSpeech("48kHz output")).toBe("四十八千赫兹 output");
  expect(normalizeForSpeech("吞吐最高 3.0 倍")).toBe("吞吐最高三点零倍");
  // Storage units fall through to the letter-by-letter fallback on purpose.
  expect(normalizeForSpeech("8.28MB")).toBe("八点二八 M B");
});

test("a currency amount says the unit after the number", () => {
  expect(normalizeForSpeech("$50 billion")).toBe("五十美元 billion");
  expect(normalizeForSpeech("¥0.05 每千字节")).toBe("零点零五元每千字节");
  expect(normalizeForSpeech("$1,000")).toBe("一千美元");
});

test("a rank and an ordinal are said as ordinals", () => {
  expect(normalizeForSpeech("ranking #2")).toBe("ranking 第二");
  expect(normalizeForSpeech("took 1st place")).toBe("took 第一 place");
});

test("an arXiv id is read digit by digit", () => {
  expect(normalizeForSpeech("arXiv:2408.12345")).toBe("archive 编号二四〇八点一二三四五");
});

test("a permille, a ratio and a clock time each get their own reading", () => {
  expect(normalizeForSpeech("5‰")).toBe("千分之五");
  expect(normalizeForSpeech("16:9")).toBe("十六比九");
  expect(normalizeForSpeech("会议 10:30 开始")).toBe("会议十点三十分开始");
});

test("a Greek letter is named", () => {
  expect(normalizeForSpeech("ζ 零点比例")).toBe("泽塔零点比例");
});

test("an approximation and a plus are said", () => {
  expect(normalizeForSpeech("up ~40%")).toBe("up 约百分之四十");
  expect(normalizeForSpeech("定量分析+可外推规律")).toBe("定量分析加可外推规律");
  expect(normalizeForSpeech("10+ skills")).toBe("十多 skills");
});

test("markdown residue never reaches the voice", () => {
  expect(normalizeForSpeech("**重要**：见 `pipeline.ts`")).toBe("重要：见 pipeline.ts");
  expect(normalizeForSpeech("详见 [机器之心](https://www.jiqizhixin.com/x)")).toBe("详见机器之心");
  expect(normalizeForSpeech("## 今日概览")).toBe("今日概览");
  expect(normalizeForSpeech("- 第一条")).toBe("第一条");
});

test("a quote is silent and a bracket is a pause", () => {
  expect(normalizeForSpeech("再登《Nature Sensors》封面")).toBe("再登 Nature Sensors 封面");
  expect(normalizeForSpeech("把「方法发现」与「调参工程」分离")).toBe("把方法发现与调参工程分离");
  expect(normalizeForSpeech("失败（650 条思路全废）了")).toBe("失败，六百五十条思路全废，了");
});

test("an em dash becomes a pause", () => {
  expect(normalizeForSpeech("不到 10 行——是可复现的")).toBe("不到十行，是可复现的");
});

test("a title written without spaces gets them", () => {
  expect(normalizeForSpeech("首token时延砍半")).toBe("首 token 时延砍半");
  expect(normalizeForSpeech("文生图Scaling新变量")).toBe("文生图 Scaling 新变量");
});

test("ASCII separators become the full-width ones the splitter knows", () => {
  expect(normalizeForSpeech("signal: two papers, one forum")).toBe("signal：two papers，one forum");
});

// --- properties -----------------------------------------------------------

test("normalization does not split sentences", () => {
  const out = normalizeForSpeech("第一条。第二条！第三条？");
  expect(out).toBe("第一条。第二条！第三条？");
  expect(out.split("\n")).toHaveLength(1);
});

test("newlines survive, because the splitter uses them as hard boundaries", () => {
  expect(normalizeForSpeech("第一条 50%\n第二条 2026-08-09")).toBe(
    "第一条百分之五十\n第二条二〇二六年八月九日",
  );
});

test("nothing readable as a digit survives a Chinese briefing line", () => {
  const line =
    "美联储 9 月加息概率被 swaps 定价在约 50%，周三 CPI 是关键：核心 CPI 环比 +0.1%（前值 -0.4%），" +
    "同比降至 2.4%、2021 年 3 月以来最低。";
  const out = normalizeForSpeech(line);
  expect(out).not.toMatch(/\d/);
  expect(out).toBe(
    "美联储九月加息概率被 swaps 定价在约百分之五十，周三 C P I 是关键：核心 C P I 环比正百分之零点一，前值负百分之零点四，同比降至百分之二点四、二〇二一年三月以来最低。",
  );
});

test("the table lookup does not answer with Object.prototype", () => {
  expect(normalizeForSpeech("the constructor and toString of it")).toBe(
    "the constructor and toString of it",
  );
});

test("empty and whitespace-only input come back empty", () => {
  expect(normalizeForSpeech("")).toBe("");
  expect(normalizeForSpeech("   \n  ")).toBe("");
});

// --- the number reader ----------------------------------------------------

test("chineseInteger reads a number by its places", () => {
  expect(chineseInteger(0)).toBe("零");
  expect(chineseInteger(5)).toBe("五");
  expect(chineseInteger(10)).toBe("十");
  expect(chineseInteger(15)).toBe("十五");
  expect(chineseInteger(105)).toBe("一百零五");
  expect(chineseInteger(110)).toBe("一百一十");
  expect(chineseInteger(1015)).toBe("一千零一十五");
  expect(chineseInteger(12000)).toBe("一万两千");
  expect(chineseInteger(20000)).toBe("两万");
  expect(chineseInteger(100005)).toBe("十万零五");
  expect(chineseInteger(343_0000)).toBe("三百四十三万");
  expect(chineseInteger(1_0000_0000)).toBe("一亿");
});

test("a leading zero means an identifier, not a quantity", () => {
  expect(normalizeForSpeech("编号 007")).toBe("编号零零七");
});
