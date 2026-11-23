import { LogOut, PanelLeft, UserRound } from "lucide-react";
import { useLocation } from "react-router-dom";

import { routeMeta } from "./nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { THEME_OPTIONS, themeOption } from "@/lib/theme";
import { useSettingsStore, type ThemeMode } from "@/stores/settings-store";

export interface TopBarProps {
  /** 移动端(<md)汉堡按钮打开 slide-over 侧栏 */
  onOpenNav: () => void;
}

/**
 * 全局顶栏(所有断点常驻):
 * 左 = 移动汉堡 + 路由 kicker/衬线标题; 右 = 主题菜单(五档, 写 settings-store) + 账户菜单(退出登录).
 */
export function TopBar({ onOpenNav }: TopBarProps) {
  const location = useLocation();
  const { username, logout } = useAuth();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const meta = routeMeta(location.pathname);
  const currentTheme = themeOption(theme);

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <IconButton
          variant="ghost"
          aria-label="打开导航"
          className="md:hidden"
          onClick={onOpenNav}
        >
          <PanelLeft aria-hidden />
        </IconButton>
        <div className="min-w-0">
          <p className="truncate text-[10px] tracking-[0.16em] text-muted-foreground/80 uppercase">
            {meta.kicker}
          </p>
          {/* 顶栏只做面包屑: 页面唯一 h1 在 PageIntro, 这里再放一个大标题会与之抢层级 */}
          <p className="truncate text-sm font-medium">{meta.title}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {/* 主题菜单: 触发器直接显示当前主题的色板, 不用记名字也能认出选了什么 */}
        <div className="hidden sm:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`主题: ${currentTheme.label}`}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface/80 py-1 pr-3 pl-1 text-xs font-medium shadow-[var(--shadow-xs)] outline-none transition-colors duration-150 ease-out hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className="size-5 rounded-full ring-1 ring-border/80 ring-inset"
                  style={{ background: currentTheme.swatch }}
                />
                <span>{currentTheme.label}</span>
                <currentTheme.icon className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>界面与阅读主题</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeMode)}>
                {THEME_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    <span
                      aria-hidden
                      className="size-4 shrink-0 rounded-full ring-1 ring-border/80 ring-inset"
                      style={{ background: option.swatch }}
                    />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* 触控热区: 视觉仍 36px(md), after 伪元素把命中区外扩到 44px, 桌面视觉不变 */}
            <IconButton
              variant="ghost"
              aria-label="账户菜单"
              className="relative rounded-full ring-1 ring-border/70 after:absolute after:-inset-1 after:content-['']"
            >
              <UserRound aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="max-w-48 truncate">
              {username ?? "未登录"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onSelect={() => void logout()}>
              <LogOut aria-hidden />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
