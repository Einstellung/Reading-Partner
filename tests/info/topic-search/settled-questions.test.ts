// A model question the topic already settles is not queued (docs/info/88
// 「攒着问」). The strings are the 2026-10-20 run's on the reader's
// mechanism-discovery topic: the topic is written in Chinese with the technical
// terms left in English, the questions came back in English.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { composePrompt } from "../../../src/info/topic-search/compose";
import { enqueue, settledBy, type NewQuestion, type PendingQuestion } from "../../../src/info/topic-search/questions";
import { rerankPrompt, SETTLED_RULE } from "../../../src/info/topic-search/rank-pool";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const TOPIC = {
  id: "ts-7556db71",
  name: "AI自主机制发现",
  concernId: null,
  scope:
    "一个系统面对黑盒，怎么自己设计实验、从观测里归纳出规律、拿规律指导下一轮实验，领域先验怎么进来；Alpha 系列（AlphaGo/AlphaZero/AlphaFold/AlphaEvolve）为什么能自己发现、没做到什么。不要多 AI 跑得久跑得稳的工程问题，不要框架发布和宣传。",
  subtopics: [],
  want: [
    "发现的闭环本身：自主设计实验、从观测归纳规律、规律指导下一轮",
    "领域先验如何被编码进发现系统",
    "评估昂贵、有噪声、温度漂移、结果依赖上一次状态的物理系统上的实验设计方法",
    "方法可跨领域迁移、有实验数据或开源代码的工作",
  ],
  avoid: ["怎么让多个 AI 跑得久、跑得稳的工程问题", "工程框架、版本发布、产品宣传、融资新闻", "纯领域内调参、方法不可迁移的工作", "角色扮演、模拟社会类多智能体"],
  judgments: [
    "手机相机调参、CUDA 算子、围棋只当实验场看：方法换个物理系统也能用才收，纯领域调参不收",
    "AlphaEvolve、FunSearch 这类生成—打分—筛选的工作归入 Alpha 系列和归纳规律两条线，不单列",
    "自驾实验室（self-driving lab）、贝叶斯优化处理噪声和漂移的工作算进物理系统实验设计这一条",
  ],
  anchors: ["experiment design", "mechanism discovery", "self-driving lab", "Bayesian optimization"],
  queries: [],
  answers: [{ asked: "围棋要不要 AlphaZero 式自我对弈？手机影像可否放宽成任何调参方法？", answer: "我们去找通用方法，不是说我们去找围棋和手机影像。", at: 0 }],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
} as TopicSearch;

const SELF_DRIVING = "Do you want self-driving-lab orchestration software, or only experiment-design methods?";
const POST_TRAINING_ASKED = "Do you want recursive self-improvement agents for LLM post-training, or does that fall under the multi-AI engineering work you excluded?";
const POST_TRAINING_AGAIN =
  "PostTrain Agent is a full autonomous experiment loop, but its domain is LLM post-training. Does that fall under the discovery loop you want, or under the multi-AI engineering you excluded?";

// Questions of the same runs that no judgement, want, avoid or earlier question settles.
const OPEN = [
  "Do you want benchmarks that measure recursive self-improvement across lab-planning and chemistry tasks, even when the focus is scoring rather than the discovery loop itself?",
  "Do you count reverse-engineering software black boxes (no source code) as the kind of black-box mechanism discovery you want, or only scientific/physical systems?",
  "Do you want work on aligning symbolic knowledge bases (proofs, schemas) via sparse autoencoders, when it's about matching existing symbols rather than inducing laws from observations?",
  "Do you want Bayesian prior-design work for inverse problems that isn't tied to an experiment-design loop?",
  "Do you want mechanistic modelling of a specific noisy bio-system when the experiment-design loop itself is not the focus?",
  "Chiplet design is the testbed here — do you count LLM-guided BO on hardware design spaces as transferable method work?",
];

test("a question a judgement already places is settled by that judgement", () => {
  expect(settledBy(SELF_DRIVING, TOPIC, [])).toBe(TOPIC.judgments[2]);
});

test("a rewording of an earlier question is settled by it", () => {
  expect(settledBy(POST_TRAINING_AGAIN, TOPIC, [POST_TRAINING_ASKED])).toBe(POST_TRAINING_ASKED);
});

test("questions the topic leaves open stay", () => {
  const raised = [POST_TRAINING_ASKED];
  for (const q of OPEN) expect(settledBy(q, TOPIC, raised)).toBeNull();
});

test("enqueue drops the settled model questions and keeps the open ones", () => {
  const asked: PendingQuestion = {
    id: "q-1",
    text: POST_TRAINING_ASKED,
    source: "model",
    template: null,
    about: [],
    raisedAt: 0,
    askedIn: "topic-search-ts-7556db71-2026-10-20",
    askedAt: 0,
  };
  const fresh: NewQuestion[] = [SELF_DRIVING, POST_TRAINING_AGAIN, ...OPEN].map((text) => ({ text, source: "model", template: null, about: [] }));
  const queue = enqueue([asked], fresh, TOPIC, 1);
  expect(queue.map((q) => q.text)).toEqual([POST_TRAINING_ASKED, ...OPEN]);
});

test("the program's own questions are not dropped for sharing the topic's words", () => {
  const metric: NewQuestion = {
    text: '"self-driving lab" has kept out 10 or more finds in each of the last 3 runs. Is that still what you want left out?',
    source: "metric",
    template: { code: "avoid-blocks", params: { avoid: "self-driving lab", runs: 3, least: 10 } },
    about: ["avoid:self-driving lab"],
  };
  expect(enqueue([], [metric], TOPIC, 1)).toHaveLength(1);
});

test("both prompts that raise questions see the answers and the questions already raised, and are told not to ask again", () => {
  const rerank = rerankPrompt(TOPIC, [], [], "", [POST_TRAINING_ASKED]);
  const write = composePrompt({
    topic: TOPIC,
    kind: "daily",
    items: [],
    registry: new MaterialRegistry("r", { write: async () => {} }),
    profile: [],
    questions: [],
    raised: [POST_TRAINING_ASKED],
    language: "",
  });
  for (const p of [rerank, write]) {
    expect(p.system).toContain(SETTLED_RULE);
    expect(p.user).toContain(`Judgements the reader accepted: ${TOPIC.judgments.join("; ")}`);
    expect(p.user).toContain(`Does not want: ${TOPIC.avoid.join("; ")}`);
    expect(p.user).toContain(`The reader's earlier answers:\n- Asked "${TOPIC.answers[0].asked}"`);
    expect(p.user).toContain(`Questions already raised (never ask them again, in any wording):\n- ${POST_TRAINING_ASKED}`);
  }
});
