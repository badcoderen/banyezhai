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

/**
 * 缓存管理：整本缓存清单 + 换源保留缓存。
 *
 * 原生换源会作废旧书缓存；这里提供「先搬缓存、再换源」的流程，让已缓存的章节
 * 换源后无缝续上，不用重新抓一遍。
 */
export default function CacheManagePage() {
  const { books, isLoading } = useBookshelf();
  const [selected, setSelected] = React.useState<Book | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="偏好与数据"
        title="缓存管理"
        desc="查看每本书的正文缓存，换源时先搬缓存再切换，已缓存章节无缝保留。"
      />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : books.length === 0 ? (
        <EmptyState title="书架为空" description="先把书加入书架，才能管理缓存。" />
      ) : (
        <ul className="divide-y divide-border/60">
          {books.map((book) => (
            <BookCacheRow key={book.bookUrl} book={book} onOpen={() => setSelected(book)} />
          ))}
        </ul>
      )}

      <CacheDetailDialog book={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BookCacheRow({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const [info, setInfo] = React.useState<{ total: number; size: number } | null>(null);

  React.useEffect(() => {
    let alive = true;
    listChapterCache(book.bookUrl)
      .then((r) => {
        if (!alive) return;
        const size = r.rows.reduce((acc, row) => acc + row.length, 0);
        setInfo({ total: r.total, size });
      })
      .catch(() => {
        if (alive) setInfo({ total: 0, size: 0 });
      });
    return () => {
      alive = false;
    };
  }, [book.bookUrl]);

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{book.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {book.author}
          {info ? (
            <span className="ml-2 inline-flex items-center gap-1">
              <HardDrive className="size-3" />
              {info.total} 章 · {formatBytes(info.size)}
            </span>
          ) : (
            <span className="ml-2 inline-flex items-center gap-1">
              <Spinner className="size-3" />
              读取中
            </span>
          )}
        </p>
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
            {rows
              ? `${rows.length} 章 · 正文 ${formatBytes(totalSize)}` +
                (emptyCount > 0 ? ` · ${emptyCount} 章为空` : "")
              : "读取中…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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
