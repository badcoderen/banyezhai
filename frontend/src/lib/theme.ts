import {
  Coffee,
  Droplets,
  Leaf,
  Monitor,
  Moon,
  MoonStar,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";

import type { ThemeMode } from "@/stores/settings-store";

export interface ThemeOption {
  value: ThemeMode;
  label: string;
  icon: LucideIcon;
  /** 色板预览: 背景(可渐变), 用于设置页的圆形/方形 swatch */
  swatch: string;
  /** swatch 上的勾选色: 深底给浅勾, 浅底给深勾 */
  checkColor: string;
}

/**
 * 主题的唯一来源: 顶栏 / 阅读器底栏 / 阅读设置面板 / 设置页偏好卡共用。
 * 三处各写一套口径时, 顶栏只露三档 → 选了其它主题的人看不到自己选了什么,
 * 底栏那个二值日夜切换还会把 sepia/system 直接改写成 light/dark。
 *
 * 配色取自三套口碑最高的开源方案:
 * - 青瓷 = Solarized Light (Ethan Schoonover)
 * - 雪原 = Nord Snow Storm
 * - 夜色 = Tokyo Night
 * 护眼绿为自研护眼色, 色值固定不参与调色。
 */
export const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "light",
    label: "日间",
    icon: Sun,
    swatch: "linear-gradient(135deg, #fffdf8 0%, #f2ece0 100%)",
    checkColor: "#8a3d34",
  },
  {
    value: "green",
    label: "护眼",
    icon: Leaf,
    swatch: "#c7edcc",
    checkColor: "#22382a",
  },
  {
    value: "sepia",
    label: "羊皮纸",
    icon: Coffee,
    swatch: "#f6eeda",
    checkColor: "#433422",
  },
  {
    value: "solarized",
    label: "青瓷",
    icon: Droplets,
    swatch: "linear-gradient(135deg, #fdf6e3 0%, #eee8d5 100%)",
    checkColor: "#14708c",
  },
  {
    value: "nord",
    label: "雪原",
    icon: Snowflake,
    swatch: "linear-gradient(135deg, #f1f4f9 0%, #d8dee9 100%)",
    checkColor: "#4a6b95",
  },
  {
    value: "tokyo",
    label: "夜色",
    icon: MoonStar,
    swatch: "linear-gradient(135deg, #1a1b26 0%, #292e42 100%)",
    checkColor: "#7aa2f7",
  },
  {
    value: "dark",
    label: "墨黑",
    icon: Moon,
    swatch: "linear-gradient(135deg, #302b29 0%, #171412 100%)",
    checkColor: "#e8c9a0",
  },
  {
    value: "system",
    label: "跟随系统",
    icon: Monitor,
    swatch: "linear-gradient(135deg, #fffdf8 0 50%, #1a1b26 50% 100%)",
    checkColor: "#14708c",
  },
];

/** 当前主题对应的展示项(未收录的取值回落到日间) */
export function themeOption(theme: ThemeMode): ThemeOption {
  return THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0]!;
}
