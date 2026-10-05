// SHIVA extension, Apache-2.0. Keep native route detection dependency-light and exact.
import { supportedLanguages } from "@homarr/translation/languages";

const locales: ReadonlySet<string> = new Set(supportedLanguages);

export const isShivaRoute = (pathname: string | null): boolean => {
  if (!pathname) return false;
  const [, first, second] = pathname.split("/");
  return first === "shiva" || (first !== undefined && locales.has(first) && second === "shiva");
};
