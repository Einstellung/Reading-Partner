// A real prep session's written steps (two pressure-cooker pots and the rice,
// in Chinese as the model wrote them), as the graph tests and the render check
// read them. One pressure cooker: the chicken cooks first, the pot is washed,
// then the beef; the rice cooker runs beside them. Laid out with the default
// kitchen it is 136 minutes before the program's packing step.

import type { PrepRun } from "../../../../src/info/meals/plan/types";
import type { PotName } from "../../../../src/info/meals/screen/prep-graph";
import { planRun } from "../../../../src/info/meals/timeline/run";
import type { Kitchen } from "../../../../src/info/meals/timeline/schedule";
import { withPackStep, type PrepStep } from "../../../../src/info/meals/timeline/steps";

export const POTS_KEY = "prep-real";
export const POTS_T0 = Date.UTC(2026, 10, 1, 9, 0);
export const POTS_KITCHEN: Kitchen = { burners: 2 };

const step = (id: string, text: string, device: PrepStep["device"], pot: string | null, active: number, wait: number, after: string[]): PrepStep => ({
  id,
  text,
  device,
  pot,
  active,
  wait,
  after,
});

export const POTS_STEPS: PrepStep[] = [
  step("1", "将洗净的洋葱和青椒切块，青柠切半。", "counter", "chicken", 3, 0, []),
  step("2", "向压力锅加入说明书要求的最低水量，放入鸡胸肉、洋葱、青椒和塔可调味粉，最上层铺番茄碎。", "pressure_cooker", "chicken", 2, 0, ["1"]),
  step("3", "盖好压力锅并设高压烹煮十二分钟，另预留约八分钟上压。", "pressure_cooker", "chicken", 1, 20, ["2"]),
  step("4", "将牛腱和洗净的洋葱分别切块，青柠切半。", "counter", "beef", 4, 0, []),
  step("5", "按所需熟饭量量取生糙米并淘洗干净。", "counter", "rice", 2, 0, []),
  step("6", "将糙米放入电饭煲，按糙米水位线加水并启动糙米模式。", "rice_cooker", "rice", 2, 60, ["5"]),
  step("7", "让压力锅自然泄压至浮阀完全落下。", "pressure_cooker", "chicken", 0, 15, ["3"]),
  step("8", "开盖检查鸡胸肉最厚处中心温度达到七十四摄氏度，确保熟透。", "pressure_cooker", "chicken", 1, 0, ["7"]),
  step("9", "将鸡胸肉移入大碗，用两把叉子撕散。", "counter", "chicken", 3, 0, ["8"]),
  step("10", "将锅内全部蔬菜酱汁和挤出的青柠汁拌入手撕鸡。", "counter", "chicken", 1, 0, ["9"]),
  step("11", "清洗压力锅内胆及锅盖，并擦干内胆外壁。", "pressure_cooker", null, 3, 0, ["10"]),
  step("12", "用压力锅煎炒档加少许油，炒香牛肉、洋葱、蒜蓉、姜蓉、咖喱粉、肉桂粉和孜然粉。", "pressure_cooker", "beef", 4, 0, ["11", "4"]),
  step("13", "加入浓缩高汤膏、减盐酱油及说明书要求的最低水量，搅匀并刮净锅底。", "pressure_cooker", "beef", 2, 0, ["12"]),
  step("14", "盖好压力锅并设高压烹煮四十分钟，另预留约十分钟上压。", "pressure_cooker", "beef", 1, 50, ["13"]),
  step("15", "让压力锅自然泄压至浮阀完全落下。", "pressure_cooker", "beef", 0, 15, ["14"]),
  step("16", "开盖用低温煎炒档收汁至牛肉熟透软烂、酱汁浓稠。", "pressure_cooker", "beef", 2, 12, ["15"]),
  step("17", "关闭加热并将挤出的青柠汁拌入牛肉。", "pressure_cooker", "beef", 1, 0, ["16"]),
];

export const POTS_NAMES: PotName[] = [
  { id: "chicken", name: "墨西哥番茄手撕鸡", short: "鸡" },
  { id: "beef", name: "干香料炖牛肉（rendang 风味）", short: "牛" },
  { id: "rice", name: "糙米饭", short: "饭" },
];

/**
 * A run that has gone exactly to plan up to `minute`: every step started when
 * planned, its hands done and its end when the plan says, as far as they are
 * behind that minute.
 */
export function onPlan(minute: number): PrepRun {
  const plan = planRun(withPackStep(POTS_STEPS), POTS_KITCHEN, null, 0);
  const steps: PrepRun["steps"] = {};
  for (const [id, p] of Object.entries(plan.placements)) {
    if (p.start > minute) continue;
    steps[id] = {
      started: p.start,
      ...(p.handsEnd <= minute ? { handsDone: p.handsEnd } : {}),
      ...(p.end <= minute ? { done: p.end } : {}),
    };
  }
  return { key: POTS_KEY, startedAt: POTS_T0, steps };
}

export const potsAt = (minute: number) => POTS_T0 + minute * 60_000 + 20_000;
