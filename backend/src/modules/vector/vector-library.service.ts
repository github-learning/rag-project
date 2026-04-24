import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { VectorMilvusService } from './vector-milvus.service';
import { MILVUS_MAX_QUERY_WINDOW } from './vector.types';
import { bookTitleFromOriginalName, normalizeUploadOriginalname } from './file-ingest.util';

@Injectable()
export class VectorLibraryService {
  private readonly logger = new Logger(VectorLibraryService.name);

  constructor(private readonly milvus: VectorMilvusService) {}

  private async libraryQueryOutputFields(): Promise<string[]> {
    const all = await this.milvus.resolveSearchOutputFields();
    const out: string[] = ['book_id'];
    if (all.includes('book_name')) out.push('book_name');
    return out;
  }

  async listKnowledgeLibrary(): Promise<{
    books: Array<{ bookId: string; bookName: string; chunkCount: number }>;
    truncated: boolean;
    collectionName: string;
  }> {
    try {
      await this.milvus.ensureMilvusLoaded();
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
    }

    const output_fields = await this.libraryQueryOutputFields();
    const PAGE = 4096;
    let offset = 0;
    let truncated = false;
    const agg = new Map<string, { bookName: string; chunkCount: number }>();

    for (;;) {
      const limit = Math.min(PAGE, MILVUS_MAX_QUERY_WINDOW - offset);
      if (limit <= 0) {
        truncated = true;
        break;
      }

      let qr: { status?: { error_code?: string | number; reason?: string }; data?: Record<string, unknown>[] };
      try {
        qr = await this.milvus.queryScalar({
          filter: 'id != ""',
          output_fields,
          limit,
          offset,
        });
      } catch (e) {
        this.milvus.throwInfrastructureError(e);
      }

      const code = qr!.status?.error_code;
      if (code !== undefined && code !== 'Success' && code !== 0 && String(code) !== '0') {
        const reason = (qr!.status as { reason?: string })?.reason ?? String(code);
        throw new BadRequestException(`Milvus 查询失败：${reason}`);
      }

      const rows = qr!.data ?? [];
      for (const row of rows) {
        const bookId = String(row.book_id ?? '');
        if (!bookId) continue;
        const bookName =
          output_fields.includes('book_name') && row.book_name != null
            ? String(row.book_name)
            : '';
        const cur = agg.get(bookId);
        if (cur) {
          cur.chunkCount += 1;
        } else {
          agg.set(bookId, { bookName, chunkCount: 1 });
        }
      }

      offset += rows.length;
      if (rows.length < limit) break;
      if (offset >= MILVUS_MAX_QUERY_WINDOW) {
        truncated = true;
        break;
      }
    }

    const books = [...agg.entries()]
      .map(([bookId, v]) => ({
        bookId,
        bookName: v.bookName,
        chunkCount: v.chunkCount,
      }))
      .sort((a, b) => b.chunkCount - a.chunkCount || a.bookName.localeCompare(b.bookName, 'zh-CN'));

    return { books, truncated, collectionName: this.milvus.getCollectionName() };
  }

  async findUploadConflicts(filename: string): Promise<{
    titleKey: string;
    existing: Array<{ bookId: string; bookName: string; chunkCount: number }>;
    canMatchByBookName: boolean;
  }> {
    const orig = normalizeUploadOriginalname(filename.trim());
    const titleKey = bookTitleFromOriginalName(orig);

    try {
      await this.milvus.ensureMilvusLoaded();
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
    }

    const output_fields = await this.libraryQueryOutputFields();
    if (!output_fields.includes('book_name')) {
      return { titleKey, existing: [], canMatchByBookName: false };
    }

    const filter = `book_name == "${this.milvus.escapeStringForExpr(titleKey)}"`;
    const PAGE = 4096;
    let offset = 0;
    const agg = new Map<string, { bookName: string; chunkCount: number }>();

    for (;;) {
      const limit = Math.min(PAGE, MILVUS_MAX_QUERY_WINDOW - offset);
      if (limit <= 0) break;

      let qr: { status?: { error_code?: string | number; reason?: string }; data?: Record<string, unknown>[] };
      try {
        qr = await this.milvus.queryScalar({
          filter,
          output_fields,
          limit,
          offset,
        });
      } catch (e) {
        this.milvus.throwInfrastructureError(e);
      }

      const code = qr!.status?.error_code;
      if (code !== undefined && code !== 'Success' && code !== 0 && String(code) !== '0') {
        const reason = qr!.status?.reason ?? String(code);
        throw new BadRequestException(`Milvus 查询失败：${reason}`);
      }

      const rows = qr!.data ?? [];
      for (const row of rows) {
        const bookId = String(row.book_id ?? '');
        if (!bookId) continue;
        const bookName = row.book_name != null ? String(row.book_name) : titleKey;
        const cur = agg.get(bookId);
        if (cur) cur.chunkCount += 1;
        else agg.set(bookId, { bookName, chunkCount: 1 });
      }

      offset += rows.length;
      if (rows.length < limit) break;
      if (offset >= MILVUS_MAX_QUERY_WINDOW) break;
    }

    const existing = [...agg.entries()].map(([bookId, v]) => ({
      bookId,
      bookName: v.bookName,
      chunkCount: v.chunkCount,
    }));

    return { titleKey, existing, canMatchByBookName: true };
  }

  async deleteVectorsByBookName(bookName: string): Promise<{ bookName: string; collectionName: string }> {
    const trimmed = bookName.trim();
    if (!trimmed) {
      throw new BadRequestException('bookName 不能为空');
    }

    try {
      await this.milvus.ensureMilvusLoaded();
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
    }

    const fields = await this.milvus.resolveSearchOutputFields();
    if (!fields.includes('book_name')) {
      throw new BadRequestException('当前集合无 book_name 字段，无法按书名删除');
    }

    const filter = `book_name == "${this.milvus.escapeStringForExpr(trimmed)}"`;
    try {
      await this.milvus.deleteByFilter(filter);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.milvus.throwInfrastructureError(e);
    }

    this.logger.log(`已按书名删除向量：「${trimmed}」`);
    return { bookName: trimmed, collectionName: this.milvus.getCollectionName() };
  }
}
