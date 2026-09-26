// The "Method & sources" screen (docs/73 屏幕, App Store 1.4.1): every formula
// with the reader's own numbers worked through, the food table with where each
// row comes from, and the medical and health-data notes. Pure, so the .tsx
// only lays it out.

import {
  FOODS,
  TAIWAN_FDA_DATASET_URL,
  TAIWAN_FDA_LICENSE_NAME,
  TAIWAN_FDA_LICENSE_URL,
  TAIWAN_FDA_VERSION,
  USDA_FDC_URL,
  sourceLabel,
} from "../nutrition/foods";
import type { Profile, Targets } from "../nutrition/targets";

/** A run of text, a link when it has a url. */
export interface TextSegment {
  text: string;
  url?: string;
}

export interface MethodSection {
  n: number;
  title: string;
  // The rule, in general terms. Multi-line; the screen keeps the line breaks.
  formula: string;
  // The rule with the reader's numbers in it. Multi-line.
  yours: string;
  // Where it comes from, with links.
  sources: TextSegment[];
}

export interface FoodTableRow {
  id: string;
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  source: string;
}

/** "[label](url)" links in a sentence, split into segments. */
export function linkSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[1] ?? "", url: m[2] ?? "" });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

const n0 = (x: number) => String(Math.round(x));
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

const GUIDE_2024 = "《成人肥胖食养指南（2024 年版）》";

/** The screen's sections, worked through with the reader's answers. */
export function methodSections(t: Targets, p: Profile): MethodSection[] {
  const male = p.sex === "m";
  const over = t.bmiCuts.overweight;
  const obese = t.bmiCuts.obese;
  const fatPct = Math.round(t.fatDefaultPct * 100);

  const bmrYours =
    t.bmrFormula === "cunningham" && t.ffm != null
      ? `FFM = ${p.weightKg} × (1 − ${((p.bodyFatPct ?? 0) / 100).toFixed(2)}) = ${f1(t.ffm)} kg\n` +
        `BMR = 22 × ${f1(t.ffm)} + 500 = ${n0(t.bmr)} kcal/day\n` +
        `(Mifflin-St Jeor would give ${n0(t.mifflin)}.)`
      : `BMR = 10 × ${p.weightKg} + 6.25 × ${p.heightCm} − 5 × ${p.age} ${male ? "+ 5" : "− 161"} = ${n0(t.bmr)} kcal/day`;

  let goalYours: string;
  if (p.goal === "cut") {
    goalYours =
      t.cutRule === "weight-percent"
        ? `BMI ${f1(t.bmi)} is under ${over}, so deficit = 0.005 × ${p.weightKg} × 7700 ÷ 7 = ${n0(t.deficit)} kcal/day. ` +
          `Weekly target = ${n0(t.tdeeAverage)} − ${n0(t.deficit)} = ${n0(t.weeklyKcal)}.`
        : `BMI ${f1(t.bmi)} → ${t.cutRule === "overweight-85" ? "85%" : "80%"} of ${n0(t.tdeeAverage)} = ${n0(t.weeklyKcal)}.`;
    goalYours += ` Floor: ${n0(t.kcalFloor)} kcal.`;
  } else if (p.goal === "gain") {
    goalYours = `Weekly target = ${n0(t.tdeeAverage)} × 1.10 = ${n0(t.weeklyKcal)}.`;
  } else {
    goalYours = `Weekly target = maintenance = ${n0(t.tdeeAverage)}.`;
  }
  goalYours +=
    `\nTraining day = ${n0(t.weeklyKcal)} × ${f2(t.palTraining)} ÷ ${t.palAverage.toFixed(3)} → ${t.training.kcal}; ` +
    `rest day = ${n0(t.weeklyKcal)} × ${f2(t.palRest)} ÷ ${t.palAverage.toFixed(3)} → ${t.rest.kcal} (rounded to 50).`;

  const rule = t.proteinRule;
  const raw = rule.kind === "ffm" ? rule.perKg * rule.ffmKg : rule.perKg * rule.refWeightKg;
  const proteinYours =
    (rule.kind === "ffm"
      ? `${rule.perKg} g × FFM ${f1(rule.ffmKg)} kg = ${n0(raw)} g`
      : `${rule.perKg} g/kg × ${f1(rule.refWeightKg)} kg${rule.usesReferenceWeight ? ` (the weight at BMI ${over})` : ""} = ${n0(raw)} g`) +
    `\nWithin ${t.proteinFloor}–${n0(t.proteinCap)} g, rounded to 5: ${t.protein} g/day on every day.`;

  const days = (label: string, d: Targets["training"]) =>
    `${label}: fat ${d.fat} g, carbs ${d.carbs} g, fat floor ${n0(d.fatFloor)} g` +
    (d.kcalRaisedForCarbs ? ", calories raised to keep carbs at the floor" : "");

  return [
    {
      n: 1,
      title: "Basal metabolic rate",
      formula:
        "With body fat (men 5–45%, women 10–55%): Cunningham\nBMR = 22 × FFM + 500,  FFM = weight × (1 − body fat)\n\n" +
        "Without: Mifflin-St Jeor\nBMR = 10W + 6.25H − 5A + 5 (men) / − 161 (women)",
      yours: bmrYours,
      sources: linkSegments(
        "Cunningham JJ. Am J Clin Nutr 1980;33:2372–4. [PubMed 7435418](https://pubmed.ncbi.nlm.nih.gov/7435418/). " +
          "Fat-free-mass formulas were the most accurate in trained adults: ten Haaf & Weijs 2014, [PMC4183531](https://pmc.ncbi.nlm.nih.gov/articles/PMC4183531/). " +
          "Mifflin MD et al. Am J Clin Nutr 1990;51:241–7, [PubMed 2305711](https://pubmed.ncbi.nlm.nih.gov/2305711/). " +
          "In Chinese adults the formulas are unbiased to slightly high, with 40–60% of people inside ±10%: [PMC6695646](https://pmc.ncbi.nlm.nih.gov/articles/PMC6695646/), [PMC3477055](https://pmc.ncbi.nlm.nih.gov/articles/PMC3477055/). " +
          "The range for accepting body fat is our own.",
      ),
    },
    {
      n: 2,
      title: "Activity factor",
      formula:
        "Work base: mostly sitting 1.40 · on your feet 1.60 · manual work 1.80\n" +
        "Training day: base + 0.20 (max 2.0) · Rest day: base\n" +
        "Weekly average = (training days × training PAL + rest days × rest PAL) ÷ 7\nTDEE = BMR × PAL",
      yours:
        `Training day PAL ${f2(t.palTraining)} → ${n0(t.tdeeTraining)} kcal; rest day ${f2(t.palRest)} → ${n0(t.tdeeRest)} kcal; ` +
        `weekly average ${t.palAverage.toFixed(3)} → ${n0(t.tdeeAverage)} kcal.`,
      sources: linkSegments(
        "1.40 / 1.70 / 2.00 are the adult PAL levels in the Chinese DRIs 2023 (WS/T 578.1 revision draft, [PDF](http://file2.foodmate.net/wenku2025/wj202501261003.pdf)). " +
          "The 1.60 and 1.80 steps and the +0.20 for a training day are our conventions; no authority publishes a table for them.",
      ),
    },
    {
      n: 3,
      title: "Calorie target",
      formula:
        `Lose fat\n  BMI < ${over}: deficit = 0.5% of weight per week × 7700 kcal/kg ÷ 7\n` +
        `  BMI ${over}–${obese}: 85% of TDEE · BMI ≥ ${obese}: 80% of TDEE\n` +
        "  Never below max(BMR, 1200 men / 1000 women)\nBuild muscle: weekly average TDEE × 1.10\nSteady energy: TDEE\n" +
        "Each day gets the weekly target × its PAL ÷ average PAL, rounded to 50.",
      yours: goalYours,
      sources: linkSegments(
        "0.5–1% of body weight per week: ISSN position stand on diets and body composition, [PMC5470183](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/). " +
          `85% / 80% and the BMR floor: ${GUIDE_2024}, [PDF](https://www.gxcdc.org.cn/uploadfile/20240326/1711416964432469.pdf). ` +
          "+10–20% for muscle gain: Iraki et al. 2019, [PMC6680710](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/). " +
          (t.region === "CN"
            ? "BMI cut-offs 24 / 28: WS/T 428-2013, [standard](https://www.ndls.org.cn/standard/detail/1459733003242ea2662cfdce73427e2b). "
            : "BMI cut-offs 25 / 30: WHO. ") +
          "7700 kcal per kg is a common convention; we have not found a primary source for it.",
      ),
    },
    {
      n: 4,
      title: "Protein",
      formula:
        "Lose fat: 1.8 g/kg if training ≥ 2×/week, else 1.4\n  with body fat known and training ≥ 2×: 2.3 g × FFM\n" +
        `Build muscle: 1.8 / 1.6 · Steady energy: 1.4 / 1.2\nBMI ≥ ${over}: use the weight at BMI ${over} instead of actual weight\n` +
        "Floor 65 g men / 55 g women · Cap 2.2 g/kg or 3.1 g/kg FFM · Rounded to 5",
      yours: proteinYours,
      sources: linkSegments(
        "ISSN protein position stand 2017 (1.4–2.0 g/kg; 0.25 g/kg a meal), [PMC5477153](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/). " +
          "2.3–3.1 g/kg FFM in a deficit: [PMC5470183](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/). " +
          "Dietary Guidelines for Americans 2025–2030 (1.2–1.6 g/kg), [PDF](https://cdn.realfood.gov/DGA.pdf).",
      ),
    },
    {
      n: 5,
      title: "Fat and carbs",
      formula:
        `Fat = ${fatPct}% of calories, never below max(0.5 g/kg, 20% of calories), at most ${Math.round(t.fatCapPct * 100)}%\n` +
        "Carbs = what is left ÷ 4, never below 130 g/day\nIf carbs would fall under 130 g, fat drops toward its floor first.\n" +
        "These two are guides: meals are solved for calories and protein,\n  and the day screen shows the fat and carbs they actually give.",
      yours: `${days("Training day", t.training)}.\n${days("Rest day", t.rest)}.`,
      sources: linkSegments(
        `Fat 20–30% of energy: ${GUIDE_2024}. Fat 0.5–1.5 g/kg: Iraki 2019. ` +
          "130 g carbohydrate RDA: Institute of Medicine, Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids (2005), [NAP 10490](https://nap.nationalacademies.org/catalog/10490).",
      ),
    },
    {
      n: 6,
      title: "Splitting across meals",
      formula:
        "Calories: breakfast 25% · lunch 35% · dinner 30% · snack 10%\nProtein: snack ≤ 10 g, the rest split evenly over three meals\n" +
        "Training day: the snack moves to right after training; the next\n  main meal takes 5% more of the day's calories, from the other two\n" +
        "Plate: protein food, ≥ 150 g veg, a staple, one spoon of sauce or oil.\n" +
        "The protein food and the staple are solved so the meal's protein\n  and calories (each food's listed kcal) both land. The oil starts\n" +
        "  at one spoon and only moves, within its cap, when the staple\n  would leave its usual range; past the cap the staple grows.\n" +
        "If the day's fat would land under the section 5 floor, each main\n  meal gets 5 g more oil and the staple shrinks to keep calories.\n" +
        "Grams rounded to 5 (eggs to whole eggs).",
      yours:
        `Training day: breakfast ${n0(t.training.meals.breakfast.kcal)}, lunch ${n0(t.training.meals.lunch.kcal)}, ` +
        `dinner ${n0(t.training.meals.dinner.kcal)}, snack ${n0(t.training.meals.snack.kcal)} kcal.\n` +
        `Rest day: breakfast ${n0(t.rest.meals.breakfast.kcal)}, lunch ${n0(t.rest.meals.lunch.kcal)}, ` +
        `dinner ${n0(t.rest.meals.dinner.kcal)}, snack ${n0(t.rest.meals.snack.kcal)} kcal.\n` +
        `Protein: ${n0(t.rest.meals.lunch.protein)} g at each main meal, ${n0(t.rest.meals.snack.protein)} g at the snack.`,
      sources: linkSegments(
        `China's 3:4:3 split (${GUIDE_2024}) with a snack carved out; the 25/35/30/10 numbers are ours. ` +
          "Veg per meal: Chinese Dietary Guidelines 2022, [plate](http://dg.cnsoc.org/article/04/ya2PbmF0S_CNY0z_Vd9HGQ.html). " +
          "The three squares on each meal read: Protein at ≥ 90% of the meal's target, Veg at ≥ 150 g (80 g for breakfast and snacks, fruit counts), Carb at ≥ 30 g (15 g for snacks).",
      ),
    },
    {
      n: 7,
      title: "Food numbers",
      formula:
        "Per 100 g. Chinese ingredients come from the Taiwan FDA Food Nutrient Database (食品營養成分資料集), " +
        "using 修正熱量 for calories, 粗蛋白, 粗脂肪 and 總碳水化合物. What it lacks comes from USDA FoodData Central " +
        "(SR Legacy and Foundation, public domain). Packaged foods use typical label values; the label on your own pack wins.",
      yours: "",
      sources: linkSegments(
        `衛生福利部食品藥物管理署，食品營養成分資料集（${TAIWAN_FDA_VERSION} 版），[data.gov.tw/dataset/8543](${TAIWAN_FDA_DATASET_URL})，` +
          `依[${TAIWAN_FDA_LICENSE_NAME}](${TAIWAN_FDA_LICENSE_URL})使用。USDA ARS, FoodData Central, [fdc.nal.usda.gov](${USDA_FDC_URL}) (CC0).`,
      ),
    },
    {
      n: 8,
      title: "When your weight changes",
      formula:
        "Tell Meals your new weight in the conversation (\"这周称了 71\"). Every target and every gram is recomputed " +
        "from it at once. The plan does not adjust itself from a weight trend.",
      yours: `Current weight: ${p.weightKg} kg.`,
      sources: [],
    },
  ];
}

/** The whole food table with each row's source, for section 7. */
export function foodTableRows(): FoodTableRow[] {
  return FOODS.map((f) => ({
    id: f.id,
    name: f.zh,
    kcal: f.kcal,
    protein: f.protein,
    fat: f.fat,
    carbs: f.carbs,
    source: sourceLabel(f),
  }));
}

export const MEDICAL_NOTE =
  "Not medical advice. This is a meal plan, not a diagnosis or treatment. Talk to a doctor or registered " +
  "dietitian before changing how you eat if you are pregnant or breastfeeding, under 18, have diabetes, " +
  "kidney or liver disease, a history of eating disorders, or take medication that depends on what you eat. " +
  "Stop and see a doctor if you feel dizzy, faint or unwell.";

export const HEALTH_DATA_NOTE =
  "Health data (height, weight, body fat, waist) is used only to calculate these targets. It stays on this " +
  "device and in your account, and is never given to third parties or used for ads.";

/** The one line at the foot of the home screen. */
export const FOOT_NOTE =
  "Food values per 100 g from the Taiwan FDA Food Nutrient Database and USDA FoodData Central; packaged " +
  "foods use typical label values. See Method & sources. Not medical advice.";
