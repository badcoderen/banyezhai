import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** data-theme 取值的唯一来源: 除 light/system 外都落到 <html data-theme> */
export const DATA_THEME_NAMES = ["sepia", "green", "solarized", "nord", "tokyo"] as const;

/** 深色系 data-theme: 需要同时挂 .dark, 让暗色工具类与 canvas 主题判定一致 */
const DARK_DATA_THEMES = new Set<string>(["tokyo"]);

/**
 * 把 settings-store 的 theme 应用到 <html>:
 * - dark: 加 `.dark` class, 移除 data-theme
 * - sepia / green / solarized / nord: 设 `data-theme`, 移除 `.dark`(浅色系主题)
 * - tokyo: 设 `data-theme` 同时保留 `.dark`(深色系主题)
 * - light / system: 清除 data-theme, `.dark` 由 matchMedia 决定; system 跟随系统实时切换
 *
 * 在 App 顶层调用一次即可(全局生效, Radix Portal 浮层挂在 body 也能继承 token).
 * 阅读器如需临时覆盖颜色, 应写 documentElement.style 内联 CSS 变量, 本 hook 不碰内联 style.
 */
export function useTheme(): void {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(DARK_QUERY);

    const apply = (systemDark: boolean): void => {
      const isDataTheme = (DATA_THEME_NAMES as readonly string[]).includes(theme);
      const dark =
        theme === "dark" ||
        DARK_DATA_THEMES.has(theme) ||
        (theme === "system" && systemDark);
      root.classList.toggle("dark", dark);
      root.dataset.themeKind = dark ? "dark" : "light";
      if (isDataTheme) {
        root.setAttribute("data-theme", theme);
      } else {
        root.removeAttribute("data-theme");
      }
    };

    apply(media.matches);

    if (theme !== "system") {
      return;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      apply(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [theme]);
}
