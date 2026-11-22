import * as React from "react";
import { CheckCircle2, CircleAlert, RefreshCw, Search, Trash2, XCircle } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PageIntro,
  Spinner,
  cn,
} from "@/components/ui";
import {
  useBookSources,
  useDeleteBookSources,
} from "@/components/sources/useSources";
import { humanizeError } from "@/lib/errors";
import { searchBook } from "@/services/search";
import type { BookSource } from "@/types/api";

/** 单源体检结果 */
type ProbeStatus = "idle" | "running" | "ok" | "fail";

interface ProbeState {
  status: ProbeStatus;
  /** 命中的书名数（>0 视为可用） */
  hits: number;
  /** 失败原因（人话） */
  reason: string;
}

/** 体检用的关键词：书名越常见越能测出源是否真能用 */
const PROBE_KEYWORDS = ["斗罗大陆", "凡人修仙传", "诡秘之主"];

/**
 * 书源即时体检：逐源真跑一次搜索，找出失效源并支持批量删除。
 *
 * 与原生「失效源检测」的区别：原生是后端在搜索/换源失败时被动打标记，
 * 这里是一键主动、并发地把所有源都打一遍搜索接口，跑出即时的可用性快照。
 */
export default function SourceHealthPage() {
  const { sources, isLoading, isFetching, refetch } = useBookSources();
  const deleteMutation = useDeleteBookSources();

  const [probes, setProbes] = React.useState<Record<string, ProbeState>>({});
  const [running, setRunning] = React.useState(false);
  const [checkedCount, setCheckedCount] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [keywordIdx, setKeywordIdx] = React.useState(0);

  const enabledSources = React.useMemo(
    () => sources.filter((s) => s.enabled),
    [sources],
  );

  const failedUrls = React.useMemo(
    () => enabledSources.filter((s) => probes[s.bookSourceUrl]?.status === "fail"),
    [enabledSources, probes],
  );

  const okCount = React.useMemo(
    () => enabledSources.filter((s) => probes[s.bookSourceUrl]?.status === "ok").length,
    [enabledSources, probes],
  );

  /** 逐个源跑一次搜索（受控并发，避免把源站打死） */
  async function runProbe() {
    if (running) return;
    setRunning(true);
    setCheckedCount(0);
    setSelected(new Set());
    const keyword = PROBE_KEYWORDS[keywordIdx % PROBE_KEYWORDS.length] ?? PROBE_KEYWORDS[0]!;

    // 每个源重置为 running
    const next: Record<string, ProbeState> = {};
    for (const s of enabledSources) {
      next[s.bookSourceUrl] = { status: "running", hits: 0, reason: "" };
    }
    setProbes(next);

    // 受控并发（一次 4 个源），逐源串行推进
    const queue = [...enabledSources];
    const concurrency = 4;
    let done = 0;
    async function worker() {
      while (queue.length > 0) {
        const src = queue.shift();
        if (!src) break;
        const srcUrl: string = src.bookSourceUrl;
        if (!srcUrl) continue;
        try {
          const hits = await searchBook(keyword, srcUrl, 1, {
            timeout: 30_000,
          });
          setProbes((prev) => ({
            ...prev,
            [srcUrl]: { status: "ok", hits: hits.length, reason: "" },
          }));
        } catch (err) {
          setProbes((prev) => ({
            ...prev,
            [srcUrl]: {
              status: "fail",
              hits: 0,
              reason: humanizeError(err instanceof Error ? err.message : String(err), "搜索失败"),
            },
          }));
        }
        done += 1;
        setCheckedCount(done);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    setRunning(false);
    setKeywordIdx((i) => i + 1);
  }

  /** 全选失效源 */
  function selectAllFailed() {
    setSelected(new Set(failedUrls.map((s) => s.bookSourceUrl)));
  }

  async function handleDelete() {
    const urls = [...selected];
    await deleteMutation.mutateAsync(urls);
    // 从体检结果里移除已删源
    setProbes((prev) => {
      const next = { ...prev };
      for (const u of urls) delete next[u];
      return next;
    });
    setSelected(new Set());
    setConfirmOpen(false);
  }

  function toggleSelect(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="源中心"
        title="书源体检"
        desc="逐源真跑一次搜索，找出失效源并批量清理。"
      />

      <div className="flex items-center gap-3">
        <Button
          onClick={runProbe}
          disabled={running || enabledSources.length === 0}
        >
          {running ? (
            <Spinner className="size-4" />
          ) : (
            <Search className="size-4" />
          )}
          {running ? `体检中 ${checkedCount}/${enabledSources.length}` : "开始体检"}
        </Button>
        <Button variant="ghost" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          刷新书源
        </Button>
        {!running && checkedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            可用 <span className="font-semibold text-foreground">{okCount}</span> · 失效{" "}
            <span className="font-semibold text-danger">{failedUrls.length}</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : enabledSources.length === 0 ? (
        <EmptyState title="没有启用的书源" description="先去「书源」页导入并启用书源，再来体检。" />
      ) : (
        <div className="flex flex-col gap-1">
          {/* 失效源汇总条 */}
          {failedUrls.length > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
              <span className="text-sm">
                发现 <span className="font-semibold text-danger">{failedUrls.length}</span> 个失效源
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={selectAllFailed}>
                  全选失效源
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="size-4" />
                  删除选中 ({selected.size})
                </Button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-border/60">
            {enabledSources.map((src) => (
              <SourceHealthRow
                key={src.bookSourceUrl}
                source={src}
                probe={probes[src.bookSourceUrl]}
                checked={selected.has(src.bookSourceUrl)}
                onToggle={() => toggleSelect(src.bookSourceUrl)}
              />
            ))}
          </ul>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 {selected.size} 个书源？</DialogTitle>
            <DialogDescription>
              删除后不可恢复，且会同步清掉这些源的搜索记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={handleDelete}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceHealthRow({
  source,
  probe,
  checked,
  onToggle,
}: {
  source: BookSource;
  probe?: ProbeState;
  checked: boolean;
  onToggle: () => void;
}) {
  const status = probe?.status ?? "idle";
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        status === "fail" && "cursor-pointer",
      )}
      onClick={status === "fail" ? onToggle : undefined}
    >
      {/* 复选框：仅失效源可勾选 */}
      {status === "fail" ? (
        <button
          type="button"
          aria-label={checked ? "取消选择" : "选择"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "flex size-5 items-center justify-center rounded border",
            checked
              ? "border-danger bg-danger text-white"
              : "border-border bg-background",
          )}
        >
          {checked && <CheckCircle2 className="size-4" />}
        </button>
      ) : (
        <span className="flex size-5 items-center justify-center" />
      )}

      {/* 源名称 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{source.bookSourceName}</p>
        {source.bookSourceGroup && (
          <p className="truncate text-xs text-muted-foreground">
            {source.bookSourceGroup}
          </p>
        )}
      </div>

      {/* 状态 */}
      <div className="flex items-center gap-2 text-sm">
        {status === "running" && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Spinner className="size-4" /> 检测中
          </span>
        )}
        {status === "ok" && (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="size-4" />
            {probe?.hits ?? 0} 本
          </span>
        )}
        {status === "fail" && (
          <span
            className="flex items-center gap-1 text-danger"
            title={probe?.reason}
          >
            <XCircle className="size-4" />
            失效
          </span>
        )}
        {status === "idle" && (
          <span className="flex items-center gap-1 text-muted-foreground/60">
            <CircleAlert className="size-4" />
            未检测
          </span>
        )}
      </div>
    </li>
  );
}
