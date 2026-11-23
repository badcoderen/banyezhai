import { FolderCog } from "lucide-react";
import * as React from "react";

import { GroupManageDialog } from "@/components/shelf/GroupManageDialog";
import { Tabs, TabsList, TabsTrigger, cn } from "@/components/ui";
import { buildShelfGroups } from "@/hooks/useBookshelf";
import type { Book, BookGroup } from "@/types/api";

export interface GroupTabsProps {
  /** 全量书架(未过滤), 用于统计每个分组的数量 */
  books: Book[];
  /** 自定义分组(getBookGroups) */
  groups: BookGroup[];
  /** 当前选中的 groupId, 内置分组为负数 */
  value: number;
  onChange: (groupId: number) => void;
  /** 卡片网格容器的 id: tab 通过 aria-controls 指向它 */
  controlsId?: string;
  className?: string;
}

/**
 * 分组 chips 行(移植自砚台原型分类胶囊): 内置分组(全部/本地/音频/未分组) + 自定义分组,
 * 窄屏横向滚动. 空分组(「全部」除外)不出现在标签里, 只剩一个分组时整条标签栏隐藏.
 */
export function GroupTabs({
  books,
  groups,
  value,
  onChange,
  controlsId,
  className,
}: GroupTabsProps) {
  const items = React.useMemo(() => buildShelfGroups(books, groups), [books, groups]);
  const [manageOpen, setManageOpen] = React.useState(false);

  if (books.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Tabs
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
        className="min-w-0 flex-1"
      >
        <TabsList
          aria-label="书架分组"
          className="scroll-x-implicit h-auto max-w-full justify-start gap-2 rounded-none bg-transparent p-0 pb-1"
        >
          {items.map(({ group, count }) => (
            <TabsTrigger
              key={group.groupId}
              value={String(group.groupId)}
              aria-controls={controlsId}
              className="min-h-10 shrink-0 rounded-full border border-border bg-surface/60 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-[var(--shadow-xs)] transition-[background-color,border-color,color,box-shadow] duration-150 ease-out hover:border-accent/40 hover:text-foreground data-[state=active]:border-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-[var(--shadow-accent)]"
            >
              {group.groupName}
              <span
                aria-hidden
                className="ml-1 rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums"
              >
                {count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <button
        type="button"
        onClick={() => setManageOpen(true)}
        aria-label="管理分组"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-accent sm:px-3"
      >
        <FolderCog aria-hidden className="size-4" />
        <span className="hidden sm:inline">管理分组</span>
      </button>
      <GroupManageDialog open={manageOpen} onOpenChange={setManageOpen} groups={groups} />
    </div>
  );
}
