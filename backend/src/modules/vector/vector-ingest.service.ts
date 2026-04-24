import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Express } from 'express';
import {
  bookTitleFromOriginalName,
  chunkText,
  extractTextFromBuffer,
  makeBookIdFromFilename,
  normalizeUploadOriginalname,
} from './file-ingest.util';
import { createEpubTextSplitter, loadEpubChapterTexts } from './epub-ingest.util';
import { VectorEmbeddingService } from './vector-embedding.service';
import { VectorMilvusService } from './vector-milvus.service';
import type { MilvusInsertRow } from './vector.types';

@Injectable()
export class VectorIngestService {
  private readonly logger = new Logger(VectorIngestService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly milvus: VectorMilvusService,
    private readonly embedding: VectorEmbeddingService,
  ) {}

  /** 主键 ID：与 ebook-writer 一致 bookId_chapterNum_chunkIndex，超长则截断 bookId */
  private makeEpubChunkId(bookId: string, chapterNum: number, chunkIndex: number): string {
    const raw = `${bookId}_${chapterNum}_${chunkIndex}`;
    if (raw.length <= 256) return raw;
    const head = bookId.slice(0, 200);
    return `${head}_${chapterNum}_${chunkIndex}`.slice(0, 256);
  }

  private async ingestEpubFile(
    file: Express.Multer.File,
    log: (line: string) => void,
  ): Promise<{
    originalName: string;
    bookId: string;
    chunks: number;
  }> {
    const orig = normalizeUploadOriginalname(file.originalname);
    const bookId = makeBookIdFromFilename(orig);
    const bookName = bookTitleFromOriginalName(orig);
    const tmpPath = join(tmpdir(), `rag-epub-${randomUUID()}.epub`);
    writeFileSync(tmpPath, file.buffer);

    let totalChunks = 0;
    try {
      log(`EPUB《${bookName}》：写入临时文件，开始解析章节…`);
      const chapters = await loadEpubChapterTexts(tmpPath);
      if (!chapters.length) {
        throw new BadRequestException(`EPUB 未解析出章节内容：${orig}`);
      }

      log(`EPUB《${bookName}》：共 ${chapters.length} 章（500 字块、重叠 50），按章向量化并写入 Milvus`);
      const splitter = createEpubTextSplitter();
      this.logger.log(`EPUB「${bookName}」共 ${chapters.length} 章，开始分块入库`);

      for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
        const chapterNum = chapterIndex + 1;
        const chunks = await splitter.splitText(chapters[chapterIndex]);
        if (!chunks.length) continue;

        log(`  · 第 ${chapterNum}/${chapters.length} 章：切分为 ${chunks.length} 段，请求 Embedding…`);
        const vectors = await this.embedding.embedDocuments(chunks);
        if (vectors.length !== chunks.length) {
          throw new BadRequestException('Embedding 返回数量与分块不一致');
        }

        const fields_data: MilvusInsertRow[] = chunks.map((content, i) => ({
          id: this.makeEpubChunkId(bookId, chapterNum, i),
          book_id: bookId,
          book_name: bookName,
          chapter_num: chapterNum,
          index: i,
          content: content.slice(0, 30000),
          vector: vectors[i],
        }));

        log(`  · 第 ${chapterNum} 章：写入 Milvus（${chunks.length} 条）并 flush…`);
        await this.milvus.insertRows(fields_data);
        totalChunks += chunks.length;
      }
      log(`EPUB《${bookName}》：完成，本文件累计 ${totalChunks} 条向量`);
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }

    return { originalName: orig, bookId, chunks: totalChunks };
  }

  /**
   * 上传文件：解析 → 分块 → embedding → Milvus（.epub 走章节 + 500/50 策略）
   */
  async ingestUploadedFiles(
    files: Express.Multer.File[],
  ): Promise<{
    totalChunks: number;
    collectionName: string;
    results: { originalName: string; bookId: string; chunks: number }[];
    ingestLog: string[];
  }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('缺少 OPENAI_API_KEY，无法计算向量');
    }

    const ingestLog: string[] = [];
    const stamp = () =>
      new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const log = (line: string) => ingestLog.push(`[${stamp()}] ${line}`);

    try {
      await this.milvus.ensureMilvusLoaded();
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
    }

    log(`Milvus 集合「${this.milvus.getCollectionName()}」已就绪`);
    log(`开始处理 ${files.length} 个文件（解析 → 分块 → Embedding → 写入向量库）`);

    const results: { originalName: string; bookId: string; chunks: number }[] = [];
    let totalChunks = 0;

    for (const file of files) {
      const orig = normalizeUploadOriginalname(file.originalname);
      const lower = orig.toLowerCase();
      const sizeKb = (file.buffer?.length ?? 0) / 1024;
      log(`—— ${orig}（约 ${sizeKb.toFixed(1)} KB）——`);

      if (lower.endsWith('.epub')) {
        const r = await this.ingestEpubFile(file, log);
        results.push(r);
        totalChunks += r.chunks;
        continue;
      }

      let text: string;
      try {
        log(`  提取文本…`);
        text = await extractTextFromBuffer(file.buffer, orig);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('UNSUPPORTED_TYPE:')) {
          const name = msg.slice('UNSUPPORTED_TYPE:'.length);
          throw new BadRequestException(
            `不支持的文件类型：${name}。当前支持 .txt、.md、.pdf、.docx、.epub`,
          );
        }
        throw new BadRequestException(`解析文件失败（${orig}）：${msg}`);
      }

      if (!text.trim()) {
        throw new BadRequestException(`文件未解析出有效文本：${orig}`);
      }

      const chunks = chunkText(text);
      if (!chunks.length) {
        log(`  无有效分块，跳过`);
        continue;
      }

      const bookId = makeBookIdFromFilename(orig);
      const bookName = bookTitleFromOriginalName(orig);

      log(`  切分为 ${chunks.length} 段（《${bookName}》），请求 Embedding…`);
      let vectors: number[][];
      try {
        vectors = await this.embedding.embedDocuments(chunks);
      } catch (e) {
        this.logger.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Embedding 调用失败：${msg}`);
      }

      if (vectors.length !== chunks.length) {
        throw new BadRequestException('Embedding 返回数量与分块不一致');
      }

      const fields_data: MilvusInsertRow[] = chunks.map((content, i) => ({
        id: randomUUID(),
        book_id: bookId,
        book_name: bookName,
        chapter_num: 1,
        index: i,
        content: content.slice(0, 30000),
        vector: vectors[i],
      }));

      log(`  写入 Milvus（${chunks.length} 条）并 flush…`);
      await this.milvus.insertRows(fields_data);

      results.push({ originalName: orig, bookId, chunks: chunks.length });
      totalChunks += chunks.length;
      log(`  完成：本文件 ${chunks.length} 条向量`);
    }

    log(`全部完成：合计 ${totalChunks} 条向量已写入「${this.milvus.getCollectionName()}」`);

    return { totalChunks, collectionName: this.milvus.getCollectionName(), results, ingestLog };
  }
}
