import type { Area } from "../types";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import pt from "./pt";
import ru from "./ru";
import zhCN from "./zh-CN";

const info: Area<typeof en> = { en, "zh-CN": zhCN, ja, ko, es, fr, de, pt, ru };

export default info;
