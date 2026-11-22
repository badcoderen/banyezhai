import { z } from "zod";

import { post, parseWith, stripNullsDeep, type ApiRequestConfig } from "@/lib/api-client";

/**
 * 换源保留缓存 + 缓存管理相关的运维接口。
 *
 * 背景：换源时后端 setBookSource 会把旧书缓存整批作废。用户往往希望「已缓存的
 * 章节不动、无缝继续」，所以需要「先搬缓存、再换源」。这些接口就是数据层的搬运
 * 与清单查询（book_chapters 表按 user_namespace 隔离，后端已带鉴权）。
 */

/** migrateChapterCache 返回 */
export const migrateResultSchema = z.object({
  found: z.number().default(0),
  moved: z.number().default(0),
  targetTotal: z.number().default(0),
  note: z.string().optional(),
});
export type MigrateResult = z.infer<typeof migrateResultSchema>;

/** listChapterCache 单行 */
export const chapterCacheRowSchema = z.object({
  chapterIndex: z.number(),
  title: z.string().default(""),
  length: z.number().default(0),
});

/** listChapterCache 返回 */
export const chapterCacheListSchema = z.object({
  url: z.string(),
  total: z.number().default(0),
  rows: z.array(chapterCacheRowSchema).default([]),
});
export type ChapterCacheList = z.infer<typeof chapterCacheListSchema>;

/** 换源映射：章节标题 → 旧章节地址（持久化在服务端，跨设备/清缓存可恢复） */
export type SwapAlias = Record<string, string[]>;

/**
 * 换源前搬缓存：把旧书 bookUrl 的正文缓存行搬到新书下。
 * 必须先调它、成功后再 setBookSource（后端换源会作废旧缓存）。
 */
export async function migrateChapterCache(
  from: string,
  to: string,
  config?: ApiRequestConfig,
): Promise<MigrateResult> {
  const data = await post<unknown>("/migrateChapterCache", { from, to }, config);
  return parseWith(migrateResultSchema, stripNullsDeep(data));
}

/** 整本缓存清单（不受 getBookCacheChapters 200 条上限影响） */
export async function listChapterCache(
  url: string,
  config?: ApiRequestConfig,
): Promise<ChapterCacheList> {
  const data = await post<unknown>("/listChapterCache", { url }, config);
  return parseWith(chapterCacheListSchema, stripNullsDeep(data));
}

/** 读取换源映射（可选带 alias 一并写入，做 upsert） */
export async function getSwapAlias(
  url: string,
  alias?: SwapAlias,
  config?: ApiRequestConfig,
): Promise<{ url: string; alias: string | null }> {
  const data = await post<unknown>("/getSwapAlias", { url, alias }, config);
  const parsed = parseWith(
    z.object({ url: z.string(), alias: z.string().nullable().optional() }),
    stripNullsDeep(data),
  );
  return { url: parsed.url, alias: parsed.alias ?? null };
}

/** 写入换源映射 */
export async function setSwapAlias(
  url: string,
  alias: SwapAlias,
  config?: ApiRequestConfig,
): Promise<void> {
  await post<unknown>("/setSwapAlias", { url, alias: JSON.stringify(alias) }, config);
}
