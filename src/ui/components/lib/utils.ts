// The class merger every shadcn component is generated against. Later classes
// win over earlier ones of the same kind, so a call site can override a variant
// with a plain className instead of a longer selector.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
