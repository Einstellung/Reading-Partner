// Meals: the four screens under ui/components/info/meals (docs/73), plus the
// vocabulary info/meals/screen/view.ts and screen-lines.ts compute for them,
// the meals tools' progress labels, and the flavour names info/meals/plan/types.ts
// defines. The source every other locale is typed against.
//
// Out of scope (docs/ui/81): info/meals/screen/onboarding.ts (the scripted
// questions and their answer options) is not an area this catalog covers — see
// the migration report. method-screen.ts's worked formulas and citations stay
// English; only its section titles and the three standing notes are here.

export default {
  title: "Meals",
  back: "Back",
  done: "Done",

  // MealsChrome
  photoCreditPrefix: "Ingredient photos from",
  trainingDay: "Training day",
  restDay: "Rest day",
  training: "Training",
  rest: "Rest",
  dailyTargets: "Daily targets",
  howCalculated: "How it's calculated ›",
  calories: "Calories",
  protein: "Protein",
  fat: "Fat",
  carbs: "Carbs",

  // MealsMethod
  methodTitle: "Method & sources",
  methodIntro: "Every number in Meals comes from the steps below. Worked lines use your answers.",
  "table.food": "Food",
  "table.source": "Source",
  "section.bmr": "Basal metabolic rate",
  "section.activity": "Activity factor",
  "section.calorieTarget": "Calorie target",
  "section.protein": "Protein",
  "section.fatCarbs": "Fat and carbs",
  "section.splitting": "Splitting across meals",
  "section.foodNumbers": "Food numbers",
  "section.weightChange": "When your weight changes",
  medicalNote:
    "Not medical advice. This is a meal plan, not a diagnosis or treatment. Talk to a doctor or registered " +
    "dietitian before changing how you eat if you are pregnant or breastfeeding, under 18, have diabetes, " +
    "kidney or liver disease, a history of eating disorders, or take medication that depends on what you eat. " +
    "Stop and see a doctor if you feel dizzy, faint or unwell.",
  healthDataNote:
    "Health data (height, weight, body fat, waist) is used only to calculate these targets. It stays on this " +
    "device and in your account, and is never given to third parties or used for ads.",
  footNote:
    "Food values per 100 g from the Taiwan FDA Food Nutrient Database and USDA FoodData Central; packaged " +
    "foods use typical label values. See Method & sources. Not medical advice.",

  // MealsDay
  askToday: "Ask about today",
  askWeekday: "Ask about {weekday}",
  minutes: "{count} min",
  ingredient: "Ingredient",
  how: "How",
  howTargetsWork: "How targets work ›",
  "recipe.open": "Full recipe",
  "recipe.openAria": "{meal}: {name}, see the full recipe",
  "recipe.writing": "Writing the steps for your kitchen…",
  "recipe.failed": "The steps could not be written.",
  "recipe.retry": "Try again",
  "recipe.listSep": ", ",
  "recipe.pack": "Pack the rest with its sauce into {count} boxes, one per meal, each marked with its day and meal: {where}.",
  "recipe.packFridge": "{boxes} in the fridge",
  "recipe.packFreezer": "{boxes} in the freezer today",
  "recipe.packJoin": "; ",
  "pot.label": "1/{count} of the {name} pot",
  "pot.box": "{weekday} {meal}",
  "pot.thaw": "Tonight, move the {box} box of {name} from the freezer to the fridge.",
  plannedAgainstTarget: "Planned against target. {arrangement}",
  arrangementTraining:
    "The snack moves to right after training; the meal after it carries more of the day's calories.",
  arrangementRest: "No training today: a little less food, the same protein.",

  // MealsPage
  askWeek: "Ask about this week",
  replayOnboarding: "Replay onboarding",
  shopping: "Shopping",
  nothingPlanned:
    "Nothing is planned. Four simple meals a day for seven days, and the shopping list that goes with them.",
  planThisWeek: "Plan this week",
  planNextWeek: "Plan next week",
  restOfWeek: "The rest of the week",
  weekRunsOut: "This week runs out after today.",

  // MealsShopping
  bought: "Bought",
  boughtDate: "Bought · {weekday}",
  askShopping: "Ask about shopping",
  progress: "{bought} of {total}",
  toGetOnWay: "To get on the way",
  didntGet: "Didn't get",
  didntGetHint: "Say so in Ask and the week adjusts",
  stillToBuy: "Still to buy",
  left: { one: "{count} left", other: "{count} left" },
  added: "added",

  // MealsOnboarding
  sex: "Sex",
  age: "Age",
  yearsUnit: "yr",
  height: "Height",
  weight: "Weight",
  bodyFatOptional: "Body fat · optional",
  bodyFatUnknown: "Don't know body fat",
  waistOptional: "Waist · optional",
  waistFill: "Add waist",
  waistHint: "Waist is only kept as a trend. It does not enter the formulas.",
  days: "Days",
  noTrainingNow: "Not training right now",
  when: "When",
  less: "Less",
  more: "More",
  next: "Next",
  peopleQuestion: "How many people are eating",
  shopWhereQuestion: "Where do you shop (pick any)",
  kitchenQuestion: "What's in your kitchen (pick any)",
  avoidQuestion: "Anything to avoid (pick any)",
  otherAvoidHint: "Say any other things to avoid directly in the conversation.",
  saveFailed: "Could not save your answers. Try again.",
  makeWeekPlan: "Make this week's plan",
  tapToChange: "Tap an answer to change it.",
  "consent.what": "What",
  "consent.why": "Why",
  "consent.where": "Where",
  "consent.undo": "Undo",
  "consent.whatValue": "Weight, body fat percentage, height, waist (waist optional).",
  "consent.whyValue":
    "Used only to work out how many calories and how much protein you need each day — nothing else.",
  "consent.whereValue": "Kept only on this device and in your account. Never given to third parties or used for ads.",
  "consent.undoValue": "You can withdraw consent and delete this data in Settings at any time.",

  // view.ts
  "mode.make": "Make",
  "mode.out": "Eat out",
  "mode.delivery": "Delivery",
  "mode.bought": "Bought",
  "mode.skip": "Skip",
  "meal.breakfast": "Breakfast",
  "meal.lunch": "Lunch",
  "meal.dinner": "Dinner",
  "meal.snack": "Snack",
  "goal.cut": "Lose fat",
  "goal.gain": "Build muscle",
  "goal.steady": "Steady energy",
  "keeps.d1-2": "1–2 days",
  "keeps.d3-5": "3–5 days",
  "keeps.w1": "1 week",
  "keeps.w2plus": "2+ weeks",
  "keeps.pantry": "pantry",
  "category.produce": "Produce",
  "category.protein": "Protein",
  "category.grains": "Grains",
  "category.dairy": "Dairy",
  "category.pantry": "Pantry",
  "category.frozen": "Frozen",
  "category.other": "Other",
  today: "Today",
  tomorrow: "Tomorrow",
  photoCredit: "Photo: {site}",
  shoppingNoteFreeze: "{keeps} · freeze on arrival",
  "targetsLine.cut":
    "Weekly average {avg} kcal a day, about {gap} under maintenance: roughly {kg} kg a week.",
  "targetsLine.gain": "Weekly average {avg} kcal a day, about {gap} over maintenance.",
  "targetsLine.steady": "Weekly average {avg} kcal a day, at maintenance.",
  overweightWarning:
    "BMI {bmi} is in the overweight range. Losing fat or holding weight first usually works better.",

  // screen-lines.ts
  cellProtein: "Protein",
  cellVeg: "Veg",
  cellCarb: "Carb",
  cellsAriaLabel: "Protein {protein}, veg {veg}, carbs {carbs}",
  yes: "yes",
  no: "no",
  mealAfterTraining: "{label} · after training",

  // tools.ts (tool progress labels, shown while a Meals tool runs)
  "tool.reworkingMeal": "Reworking a meal",
  "tool.draftingWeek": "Drafting this week's meals",
  "tool.updatingTargets": "Updating your meal targets",
  "tool.recordingDeviation": "Recording what you ate instead",
  "tool.addingToList": "Adding to the shopping list",
  "tool.removingFromList": "Taking a line off the shopping list",
  "tool.swappingLine": "Swapping a line on the shopping list",
  "tool.rewritingMethod": "Rewriting how it's made",
  "tool.refreshingPhotos": "Looking for better photographs",

  // plan/types.ts FLAVOURS, as displayed (the ids and their Chinese names, used
  // to steer the model, are unchanged; this is only what the reader sees)
  "flavour.soy-ginger": "Soy & ginger",
  "flavour.garlic": "Garlic",
  "flavour.scallion-oil": "Scallion oil",
  "flavour.tomato": "Tomato",
  "flavour.curry": "Curry",
  "flavour.sesame": "Sesame",
  "flavour.teriyaki": "Teriyaki",
  "flavour.sweet-sour": "Sweet & sour",
  "flavour.spicy-sichuan": "Sichuan spicy",
  "flavour.hot-sour": "Hot & sour",
  "flavour.black-pepper": "Black pepper",
  "flavour.lemon-pepper": "Lemon pepper",
  "flavour.vinaigrette": "Vinaigrette",
  "flavour.miso": "Miso",
  "flavour.pesto": "Pesto",
  "flavour.sweet": "Sweet",
  "flavour.plain": "Plain",

  // Units and macro initials in the number lines and tables, so a table says
  // what the sentence under it says.
  "unit.kcal": "kcal",
  "unit.g": "g",
  "unit.min": "min",
  "abbr.protein": "P",
  "abbr.fat": "F",
  "abbr.carbs": "C",
  "guideLine": "Fat {fat} g · Carbs {carbs} g (guide {fatTarget} / {carbsTarget} g)",

  // list-order.ts: the shopping card's status and preview lines
  "shopping.left": "{count} left",
  "shopping.bought": "Bought · {weekday}",
  "shopping.toGet": "{count} to get",
  "shopping.missed": "{count} you didn't get",
  "shopping.allGot": "Everything on the list.",
  "shopping.more": "and {count} more",

  // tools.ts: what a meals write left behind (the receipt under the answer)
  "receipt.draftedWeek": "Drafted the week",
  "receipt.reworkedMeal": "Reworked a meal",
  "receipt.updatedProfile": "Updated your profile",
  "receipt.recordedDeviation": "Recorded a change of plan",
  "receipt.addedToList": "Added to the shopping list",
  "receipt.removedFromList": "Took a line off the list",
  "receipt.swappedLine": "Swapped a line on the list",
  "receipt.rewroteMethod": "Rewrote how it's made",

  // The profile fields a receipt names when the reader changed them
  "field.weightKg": "Weight",
  "field.heightCm": "Height",
  "field.bodyFatPct": "Body fat",
  "field.waistCm": "Waist",
  "field.goal": "Goal",
  "field.trainingDays": "Training days",
  "field.trainTime": "Training time",
  "field.work": "Work",
  "field.effort": "Effort",
  "field.people": "People eating",
  "field.dislikes": "Dislikes",
  "field.shops": "Shops",
  "field.kitchen": "Kitchen",
  "field.notes": "Notes",

  // Between the meals a receipt or the applied line names
  "listJoin": ", ",

  // The line drawn after the plan card's Apply (cards.ts MealsAppliedCardData)
  "applied.week": "Saved the week · {count} to buy",
  "applied.change": "Changed {meals} · {count} to buy",
  "applied.freeze": "{count} to freeze on arrival",
} as const;
