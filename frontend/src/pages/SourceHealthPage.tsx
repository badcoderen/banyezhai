import * as React from "react";
import {
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  RefreshCw,
  Search,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";

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
import { SourceGroupTabs } from "@/components/sources/SourceGroupTabs";
import {
  SOURCE_GROUP_ALL,
  buildSourceGroups,
  filterSources,
  useBookSources,
  useDeleteBookSources,
} from "@/components/sources/useSources";
import { humanizeError } from "@/lib/errors";
import { getJSON, setJSON } from "@/lib/storage";
import { searchBook } from "@/services/search";
import type { BookSource } from "@/types/api";

/**
 * 逐源体检结论:
 * - ok    搜索成功且有条目 → 源可用
 * - empty 搜索成功但 0 条   → 源活着, 只是这个词搜不到(规则可能只对特定书生效)
 * - fail  请求报错 / 超时   → 判定失效
 */
type ProbeStatus = "idle" | "running" | "ok" | "empty" | "fail";

interface ProbeState {
  status: ProbeStatus;
  /** 命中的书名数 */
  hits: number;
  /** 失败原因(人话) */
  reason: string;
  /** 完成时间戳(ms), 用于展示「几分钟前测的」 */
  at: number;
}

/** 体检用的关键词: 轮换着用, 避免某个源恰好收录这本书而误判 */
const PROBE_KEYWORDS = ["斗破苍穹", "斗罗大陆", "凡人修仙传", "诡秘之主"];
const CONCURRENCY = 4;
const PROBE_TIMEOUT = 20_000;

/** 结果落盘: 几百个源跑一遍要几分钟, 切页/刷新后不该白跑 */
const STORAGE_KEY = "reader.sourceHealth.v1";

interface PersistedRun {
  keyword: string;
  at: number;
  results: Record<string, ProbeState>;
}

/** 状态筛选: 与三态一一对应, 外加「未检测」 */
type StatusFilter = "all" | "fail" | "empty" | "ok" | "idle";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "fail", label: "失效" },
  { value: "empty", label: "无结果" },
  { value: "ok", label: "正常" },
  { value: "idle", label: "未检测" },
];

/**
 * 书源体检: 逐源真跑一次搜索, 分「正常 / 无结果 / 失效」三类, 支持按分组圈定范围、
 * 按结论筛选、批量清理。
 *
 * 与原生「失效源检测」的区别: 原生是后端在搜索/换源失败时被动打标记, 这里是一键
 * 主动、受控并发地把选中的源都打一遍搜索接口, 得到即时的可用性快照。
 */
export default function SourceHealthPage() {
  const { sources, isLoading, isFetching, refetch } = useBookSources();
  const deleteMutation = useDeleteBookSources();

  const [probes, setProbes] = React.useState<Record<string, ProbeState>>({});
  const [running, setRunning] = React.useState(false);
  const [checkedCount, setCheckedCount] = React.useState(0);
  const [probeTotal, setProbeTotal] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [group, setGroup] = React.useState<string>(SOURCE_GROUP_ALL);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [keyword, setKeyword] = React.useState<string>(PROBE_KEYWORDS[0]!);
  /** 上一轮实际使用的关键词: 轮换后 keyword 已指向下一次, 行内文案必须用这个 */
  const [runKeyword, setRunKeyword] = React.useState<string>("");
  const [lastRunAt, setLastRunAt] = React.useState<number>(0);
  const cancelRef = React.useRef(false);

  /** 只体检启用中的源 */
  const enabledSources = React.useMemo(() => sources.filter((s) => s.enabled), [sources]);

  const groupItems = React.useMemo(() => buildSourceGroups(enabledSources), [enabledSources]);

  /** 当前分组圈定的范围: 统计与体检都以它为准 */
  const scopedSources = React.useMemo(
    () => filterSources(enabledSources, group, ""),
    [enabledSources, group],
  );

  // 首次进入: 恢复上一次的体检结果
  React.useEffect(() => {
    const saved = getJSON<PersistedRun>(STORAGE_KEY);
    if (!saved || !saved.results) return;
    setProbes(saved.results);
    setKeyword(saved.keyword || PROBE_KEYWORDS[0]!);
    setRunKeyword(saved.keyword || "");
    setLastRunAt(saved.at || 0);
  }, []);

  // 分组被清空(整组源都被删掉)时回到「全部」, 避免停在空列表
  React.useEffect(() => {
    if (group !== SOURCE_GROUP_ALL && !groupItems.some((g) => g.value === group)) {
      setGroup(SOURCE_GROUP_ALL);
    }
  }, [group, groupItems]);

  const counts = React.useMemo(() => {
    const acc = { ok: 0, empty: 0, fail: 0, idle: 0, running: 0 };
    for (const src of scopedSources) {
      const status = probes[src.bookSourceUrl]?.status ?? "idle";
      acc[status] += 1;
    }
    return acc;
  }, [scopedSources, probes]);

  /** 可清理 = 失效 + 无结果 */
  const cleanableCount = counts.fail + counts.empty;

  const visibleSources = React.useMemo(() => {
    if (statusFilter === "all") return scopedSources;
    return scopedSources.filter((s) => {
      const status = probes[s.bookSourceUrl]?.status ?? "idle";
      // 「未检测」卡片把检测中也算进去了, 筛选必须一致, 否则数字和列表对不上
      return statusFilter === "idle" ? status === "idle" || status === "running" : status === statusFilter;
    });
  }, [scopedSources, statusFilter, probes]);

  function saveRun(next: Record<string, ProbeState>, kw: string) {
    setJSON<PersistedRun>(STORAGE_KEY, { keyword: kw, at: Date.now(), results: next });
  }

  /** 逐源跑一次搜索(受控并发), 按命中数分三态 */
  async function runProbe() {
    if (running || scopedSources.length === 0) return;
    const list = [...scopedSources];
    const kw = keyword;
    cancelRef.current = false;
    setRunning(true);
    setRunKeyword(kw);
    setCheckedCount(0);
    setProbeTotal(list.length);
    setSelected(new Set());
    setStatusFilter("all");

    let snapshot: Record<string, ProbeState> = { ...probes };
    for (const s of list) {
      snapshot[s.bookSourceUrl] = { status: "running", hits: 0, reason: "", at: 0 };
    }
    setProbes(snapshot);

    const queue = [...list];
    let done = 0;

    async function worker() {
      while (!cancelRef.current) {
        const src = queue.shift();
        if (!src) break;
        const url = src.bookSourceUrl;
        let next: ProbeState;
        try {
          const hits = await searchBook(kw, url, 1, { timeout: PROBE_TIMEOUT });
          next =
            hits.length > 0
              ? { status: "ok", hits: hits.length, reason: "", at: Date.now() }
              : { status: "empty", hits: 0, reason: "", at: Date.now() };
        } catch (err) {
          next = {
            status: "fail",
            hits: 0,
            reason: humanizeError(err instanceof Error ? err.message : String(err), "搜索失败"),
            at: Date.now(),
          };
        }
        snapshot = { ...snapshot, [url]: next };
        setProbes(snapshot);
        done += 1;
        setCheckedCount(done);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker()),
    );

    // 手动停止时把还停在 running 的源回落成 idle, 免得一直转圈
    for (const s of list) {
      if (snapshot[s.bookSourceUrl]?.status === "running") {
        snapshot[s.bookSourceUrl] = { status: "idle", hits: 0, reason: "", at: 0 };
      }
    }
    setProbes(snapshot);
    setRunning(false);
    setLastRunAt(Date.now());
    saveRun(snapshot, kw);
    // 词表轮换, 下次换个关键词再测一遍
    setKeyword((prev) => {
      const i = PROBE_KEYWORDS.indexOf(prev);
      return PROBE_KEYWORDS[(i + 1) % PROBE_KEYWORDS.length]!;
    });
  }

  function stopProbe() {
    cancelRef.current = true;
  }

  /** 按结论全选(只作用于当前分组) */
  function selectStatuses(statuses: ProbeStatus[]) {
    setSelected(
      new Set(
        scopedSources
          .filter((s) => statuses.includes(probes[s.bookSourceUrl]?.status ?? "idle"))
          .map((s) => s.bookSourceUrl),
      ),
    );
  }

  async function handleDelete() {
    const urls = [...selected];
    try {
      await deleteMutation.mutateAsync(urls);
    } catch {
      // 失败提示由 mutation 的 onError 统一 toast, 这里保持弹窗打开供重试
      return;
    }
    const next = { ...probes };
    for (const u of urls) delete next[u];
    setProbes(next);
    saveRun(next, runKeyword || keyword);
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

  const hasRun = counts.ok + counts.empty + counts.fail > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        eyebrow="工具箱 · 源中心"
        title="书源体检"
        desc="逐源真跑一次搜索, 把源分成「正常 / 无结果 / 失效」三类, 一键清理坏源; 结果会记住, 下次进来还在."
      />

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button onClick={stopProbe} variant="secondary">
            <Square className="size-4" />
            停止（{checkedCount}/{probeTotal}）
          </Button>
        ) : (
          <Button onClick={() => void runProbe()} disabled={scopedSources.length === 0}>
            <Search className="size-4" />
            开始体检
          </Button>
        )}
        <Button variant="ghost" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          刷新书源
        </Button>
        <span className="text-sm text-muted-foreground">
          本轮关键词 <span className="font-medium text-foreground">「{keyword}」</span>
          {lastRunAt > 0 ? ` · 上次体检 ${formatAgo(lastRunAt)}` : null}
        </span>
      </div>

      {/* 结论统计: 点一下筛到那一类, 再点回到全部 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="正常"
          value={counts.ok}
          tone="ok"
          active={statusFilter === "ok"}
          onClick={() => setStatusFilter(statusFilter === "ok" ? "all" : "ok")}
        />
        <StatCard
          label="无结果"
          value={counts.empty}
          tone="warn"
          active={statusFilter === "empty"}
          onClick={() => setStatusFilter(statusFilter === "empty" ? "all" : "empty")}
        />
        <StatCard
          label="失效"
          value={counts.fail}
          tone="danger"
          active={statusFilter === "fail"}
          onClick={() => setStatusFilter(statusFilter === "fail" ? "all" : "fail")}
        />
        <StatCard
          label="未检测"
          value={counts.idle + counts.running}
          tone="muted"
          active={statusFilter === "idle"}
          onClick={() => setStatusFilter(statusFilter === "idle" ? "all" : "idle")}
        />
      </div>

      {/* 分组 + 状态筛选 */}
      <div className="flex flex-col gap-2">
        <SourceGroupTabs
          groups={groupItems}
          value={group}
          onChange={setGroup}
          controlsId="health-list"
          className="min-w-0"
        />
        <div className="scroll-x-implicit flex items-center gap-1.5">
          {STATUS_FILTERS.map((item) => {
            const active = statusFilter === item.value;
            const count =
              item.value === "all"
                ? scopedSources.length
                : item.value === "fail"
                  ? counts.fail
                  : item.value === "empty"
                    ? counts.empty
                    : item.value === "ok"
                      ? counts.ok
                      : counts.idle + counts.running;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setStatusFilter(item.value)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                  active
                    ? "border-accent bg-accent/10 font-medium text-accent"
                    : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {item.label}
                <span className="ml-1 tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 清理条 */}
      {cleanableCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
          <span className="text-sm">
            本组可清理 <span className="font-semibold text-danger">{cleanableCount}</span> 个（失效{" "}
            {counts.fail} · 无结果 {counts.empty}）
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => selectStatuses(["fail"])}>
              全选失效
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selectStatuses(["empty"])}>
              全选无结果
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selectStatuses(["fail", "empty"])}>
              全选可清理
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-4" />
              删除选中（{selected.size}）
            </Button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : enabledSources.length === 0 ? (
        <EmptyState
          title="没有启用的书源"
          description="先去「书源」页导入并启用书源，再来体检。"
        />
      ) : visibleSources.length === 0 ? (
        <EmptyState
          title={hasRun ? "这一类里没有书源" : "还没开始体检"}
          description={
            hasRun
              ? "换个筛选条件看看，或者切到别的分组。"
              : "点上面的「开始体检」，逐源跑一次搜索就知道谁还能用。"
          }
        />
      ) : (
        <ul id="health-list" className="divide-y divide-border/60 border-y border-border/60">
          {visibleSources.map((src) => (
            <SourceHealthRow
              key={src.bookSourceUrl}
              source={src}
              probe={probes[src.bookSourceUrl]}
              keyword={runKeyword}
              checked={selected.has(src.bookSourceUrl)}
              onToggle={() => toggleSelect(src.bookSourceUrl)}
            />
          ))}
        </ul>
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
              onClick={() => void handleDelete()}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 统计卡: 点一下筛选到该类, 再点回到全部 */
function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger" | "muted";
  active: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === "ok"
      ? "text-success"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-muted-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        active ? "border-accent bg-accent/10" : "border-border bg-surface/60 hover:bg-surface-muted",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xl leading-none font-semibold tabular-nums", toneClass)}>
        {value}
      </span>
    </button>
  );
}

function SourceHealthRow({
  source,
  probe,
  keyword,
  checked,
  onToggle,
}: {
  source: BookSource;
  probe?: ProbeState;
  keyword: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const status = probe?.status ?? "idle";
  const selectable = status === "fail" || status === "empty";

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-2.5",
        selectable && "cursor-pointer hover:bg-surface-muted/60",
      )}
      onClick={selectable ? onToggle : undefined}
    >
      {selectable ? (
        <button
          type="button"
          aria-label={checked ? "取消选择" : "选择"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border",
            checked ? "border-danger bg-danger text-white" : "border-border bg-background",
          )}
        >
          {checked && <CheckCircle2 className="size-4" />}
        </button>
      ) : (
        <span className="mt-0.5 size-5 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{source.bookSourceName}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {source.bookSourceGroup || "未分组"}
          {status === "fail" && probe?.reason ? (
            <span className="ml-2 text-danger/90">· {probe.reason}</span>
          ) : null}
          {status === "empty" ? (
            <span className="ml-2 text-warn">
              {keyword ? `搜「${keyword}」0 条` : "0 条结果"} · 源可能只收录特定书
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-sm">
        {status === "running" && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Spinner className="size-4" /> 检测中
          </span>
        )}
        {status === "ok" && (
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="size-4" />
            正常 · {probe?.hits ?? 0} 本
          </span>
        )}
        {status === "empty" && (
          <span className="flex items-center gap-1 text-warn">
            <CircleSlash className="size-4" />
            无结果
          </span>
        )}
        {status === "fail" && (
          <span className="flex items-center gap-1 text-danger" title={probe?.reason}>
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

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}
