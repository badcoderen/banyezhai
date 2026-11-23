import type { ReactNode } from "react";

import { cn } from "./cn";

export interface PageIntroProps {
  /** 大写英文小标, 如 "SOURCE CENTER" */
  eyebrow: string;
  /** 页面名, 渲染为全页唯一 h1 */
  title: string;
  /** 补充描述, 可选 */
  desc?: string;
  /** 右侧操作区(按钮等), lg 起与标题底部对齐 */
  action?: ReactNode;
  className?: string;
}

/** 页首标题区: eyebrow + 页面名(h1) + 描述 + 右侧动作, 底部分隔线. 页面名压到 26/30px, 给内容让位. */
export function PageIntro({ eyebrow, title, desc, action, className }: PageIntroProps) {
  return (
    <section
      className={cn(
        "mb-5 flex flex-col justify-between gap-4 border-b border-border/70 pb-4 sm:mb-7 sm:pb-6 lg:flex-row lg:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="mb-2 hidden items-center gap-2.5 sm:flex">
          <span aria-hidden className="h-px w-7 bg-accent/60" />
          <p className="text-[11px] font-semibold tracking-[0.22em] text-accent uppercase">
            {eyebrow}
          </p>
        </div>
        <h1 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-[30px]">
          {title}
        </h1>
        {desc ? (
          <p className="mt-2.5 hidden max-w-2xl text-sm leading-relaxed text-muted-foreground sm:block">
            {desc}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </section>
  );
}
