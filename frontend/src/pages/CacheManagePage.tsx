import * as React from "react";
import { ArrowLeftRight, Database, HardDrive } from "lucide-react";

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
import { useBookshelf } from "@/hooks/useBookshelf";
import {
  getAvailableBookSource,
  setBookSource,
  type AvailableBookSource,
} from "@/services/explore";
import { listChapterCache, migrateChapterCache } from "@/services/ops";
import type { Book } from "@/types/api";

/** 缓存清单里单章状态 */
interface ChapterRow {
  index: number;
  title: string;
  length: number;
}

/** 单书缓存统计: 已缓存章数 + 正文字节数 */
interface CacheStat {
  cached: number;
  size: number;
}

/**
 * 缓存管理：整本缓存清单 + 换源保留缓存。
 *
 * 原生换源会作废旧书缓存；这里提供「先搬缓存、再换源」的流程，让已缓存的章节
 * 换源后无缝续上，不用重新抓一遍。
 */
export default function CacheManagePage() {
  const { books, isLoading } = useBookshelf();
  const [selected, setSelected] = React.useState<Book | null>(null);
  const [stats, setStats] = React.useState<Record<string, CacheStat>>({});
  const [statsLoading, setStatsLoading] = React.useState(false);

  // 每本书的已缓存章数: 页级统一拉一次(受控并发), 行内直接用, 顺带累加出总览
  React.useEffect(() => {
    if (books.length === 0) {
      setStats({});
      setStatsLoading(false);
      return;
    }
    let alive = true;
    setStatsLoading(true);
    const next: Record<string, CacheStat> = {};
    const queue = books.map((b) => b.bookUrl);

    async function worker() {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) break;
        try {
          const r = await listChapterCache(url);
          next[url] = { cached: r.total, size: r.rows.reduce((acc, row) => acc + row.length, 0) };
        } catch {
          next[url] = { cached: 0, size: 0 };
        }
        if (alive) setStats({ ...next });
      }
    }

    void Promise.all(Array.from({ length: Math.min(4, books.length) }, () => worker())).then(() => {
      if (alive) setStatsLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [books]);

  const summary = React.useMemo(() => {
    let total = 0;
    let cached = 0;
    let size = 0;
    for (const book of books) {
      total += book.totalChapterNum ?? 0;
      const st = stats[book.bookUrl];
      if (st) {
        cached += st.cached;
        size += st.size;
      }
    }
    // 没缓存满时向下取整, 免得 1314/1316 也显示 100%
    const pct = total > 0 ? (cached >= total ? 100 : Math.floor((cached / total) * 100)) : 0;
    return { total, cached, size, pct };
  }, [books, stats]);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="工具箱 · 偏好与数据"
        title="缓存管理"
        desc="查看每本书「共多少章 / 已缓存多少章」，换源时先搬缓存再切换，已缓存章节无缝保留。"
      />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : books.length === 0 ? (
        <EmptyState title="书架为空" description="先把书加入书架，才能管理缓存。" />
      ) : (
        <>
          {/* 总览: 书架规模 + 缓存覆盖率 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-surface/60 px-4 py-3 text-sm">
            <span>
              书架 <span className="font-semibold tabular-nums">{books.length}</span> 本
            </span>
            <span>
              共 <span className="font-semibold tabular-nums">{summary.total || "—"}</span> 章
            </span>
            <span>
              已缓存{" "}
              <span className="font-semibold text-accent tabular-nums">{summary.cached}</span> 章
              {summary.total > 0 ? (
                <span className="text-muted-foreground">（{summary.pct}%）</span>
              ) : null}
            </span>
            <span className="text-muted-foreground">{formatBytes(summary.size)}</span>
            {statsLoading ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                统计中
              </span>
            ) : null}
          </div>

          <ul className="divide-y divide-border/60">
            {books.map((book) => (
              <BookCacheRow
                key={book.bookUrl}
                book={book}
                info={stats[book.bookUrl] ?? null}
                onOpen={() => setSelected(book)}
              />
            ))}
          </ul>
        </>
      )}

      <CacheDetailDialog book={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BookCacheRow({
  book,
  info,
  onOpen,
}: {
  book: Book;
  info: CacheStat | null;
  onOpen: () => void;
}) {
  const bookTotal = book.totalChapterNum ?? 0;
  /** 缓存覆盖率: 只在服务端给过目录总章数时才有意义 */
  const pct =
    bookTotal > 0 && info
      ? info.cached >= bookTotal
        ? 100
        : Math.floor((info.cached / bookTotal) * 100)
      : 0;

  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{book.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {book.author}
          {info ? (
            <span className="ml-2 inline-flex flex-wrap items-center gap-1">
              <HardDrive className="size-3" />
              共 {bookTotal > 0 ? bookTotal : "—"} 章 · 已缓存{" "}
              <span className="font-medium text-foreground">{info.cached}</span> 章
              {bookTotal > 0 ? ` · ${pct}%` : ""} · {formatBytes(info.size)}
            </span>
          ) : (
            <span className="ml-2 inline-flex items-center gap-1">
              <Spinner className="size-3" />
              读取中
            </span>
          )}
        </p>
        {/* 覆盖率进度条: 一眼看出这本书还差多少章没缓存 */}
        {info && bookTotal > 0 ? (
          <div
            className="mt-1.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-border/70"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`已缓存 ${info.cached} / 共 ${bookTotal} 章`}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <Database className="size-4" />
        管理
      </Button>
    </li>
  );
}

function CacheDetailDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const [rows, setRows] = React.useState<ChapterRow[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState<AvailableBookSource[] | null>(null);
  const [migrating, setMigrating] = React.useState<string | null>(null);
  const [migrateNote, setMigrateNote] = React.useState<string>("");

  React.useEffect(() => {
    if (!book) return;
    let alive = true;
    setRows(null);
    setLoading(true);
    setMigrateNote("");
    listChapterCache(book.bookUrl)
      .then((r) => {
        if (!alive) return;
        setRows(r.rows.map((row) => ({ index: row.chapterIndex, title: row.title, length: row.length })));
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [book]);

  if (!book) return null;
  const b = book;

  const totalSize = rows ? rows.reduce((acc, r) => acc + r.length, 0) : 0;
  const emptyCount = rows ? rows.filter((r) => r.length === 0).length : 0;
  const bookTotal = book.totalChapterNum ?? 0;
  const cachedCount = rows?.length ?? 0;
  const pct =
    bookTotal > 0
      ? cachedCount >= bookTotal
        ? 100
        : Math.floor((cachedCount / bookTotal) * 100)
      : 0;

  /** 换源：先搬缓存，成功后再 setBookSource */
  async function handleSwitch(candidate: AvailableBookSource) {
    if (!candidates) return;
    setMigrating(candidate.bookUrl);
    setMigrateNote("");
    try {
      const result = await migrateChapterCache(b.bookUrl, candidate.bookUrl);
      setMigrateNote(
        result.found > 0
          ? `已搬 ${result.moved} 章缓存（原 ${result.found} 章）`
          : "旧书没有缓存行，直接换源",
      );
      await setBookSource({
        bookUrl: b.bookUrl,
        newBookUrl: candidate.bookUrl,
        bookSourceUrl: candidate.origin,
        name: b.name,
        author: b.author,
      });
      onClose();
    } catch (err) {
      setMigrateNote(
        err instanceof Error ? `失败：${err.message}` : "换源失败，缓存未动",
      );
    } finally {
      setMigrating(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>《{book.name}》缓存</DialogTitle>
          <DialogDescription>
            {rows ? (
              <>
                已缓存 <span className="font-medium text-foreground">{cachedCount}</span> 章 / 共{" "}
                {bookTotal > 0 ? `${bookTotal} 章` : "未知章"}（{pct}%）· 正文{" "}
                {formatBytes(totalSize)}
                {emptyCount > 0 ? ` · ${emptyCount} 章为空` : ""}
              </>
            ) : (
              "读取中…"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 缓存覆盖率 */}
          {rows && bookTotal > 0 ? (
            <div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-border/70"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`已缓存 ${cachedCount} / 共 ${bookTotal} 章`}
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                已缓存 {cachedCount} 章 · 还剩 {Math.max(0, bookTotal - cachedCount)} 章未缓存
              </p>
            </div>
          ) : null}
          {/* 换源搬缓存 */}
          <div className="rounded-lg border border-border/60 p-4">
            <p className="mb-2 text-sm font-medium">换源（保留缓存）</p>
            {migrateNote && (
              <p className="mb-2 text-xs text-success">{migrateNote}</p>
            )}
            {candidates === null ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void getAvailableBookSource(book.bookUrl).then(setCandidates)
                }
              >
                <ArrowLeftRight className="size-4" />
                查看可换的源
              </Button>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无可换的源</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {candidates
                  .filter((c) => c.bookUrl !== book.bookUrl)
                  .map((c) => (
                    <li key={c.bookUrl} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.originName || c.origin}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={migrating === c.bookUrl}
                        onClick={() => void handleSwitch(c)}
                      >
                        {migrating === c.bookUrl ? "搬缓存中" : "先搬缓存再换"}
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* 缓存清单 */}
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
            {loading ? (
              <div className="flex justify-center py-12">
                <Spinner className="size-5" />
              </div>
            ) : rows === null ? null : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无缓存章节
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {rows.map((r) => (
                  <li key={r.index} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{r.title || `第 ${r.index} 章`}</span>
                    <span
                      className={cn(
                        "text-xs",
                        r.length > 0 ? "text-success" : "text-warn",
                      )}
                    >
                      {r.length > 0 ? formatBytes(r.length) : "空"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
