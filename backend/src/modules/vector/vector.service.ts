import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { DataType, MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
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

export type VectorHitRow = {
  id: string;
  score: number;
  book_id: string;
  /** 书名（EPUB / 入库脚本对齐字段，可为空） */
  book_name?: string;
  chapter_num: number;
  index: number;
  contentPreview: string;
};

type MilvusInsertRow = {
  id: string;
  book_id: string;
  book_name: string;
  chapter_num: number;
  index: number;
  content: string;
  vector: number[];
};

@Injectable()
export class VectorService implements OnModuleInit {
  private readonly logger = new Logger(VectorService.name);
  private client!: MilvusClient;
  private embeddings!: OpenAIEmbeddings;
  private collectionName!: string;
  private vectorDim!: number;
  private milvusReady: Promise<void> | null = null;
  /** describeCollection 缓存：旧库可能无 book_name，避免 search 请求不存在的输出列 */
  private searchOutputFields: string[] | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const address = this.config.get<string>('MILVUS_ADDRESS', 'localhost:19530');
    this.collectionName = this.config.get<string>('COLLECTION_NAME', 'ebook_collection');
    this.vectorDim = Number(this.config.get<string>('VECTOR_DIM', '1024'));

    this.client = new MilvusClient({ address });

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY 未设置：向量检索将无法计算 query embedding');
    }

    // DashScope 等兼容接口限制单次 embedding 条数（如 ≤10）；官方 OpenAI 可设更大，见 EMBEDDING_BATCH_SIZE
    const batchParsed = parseInt(this.config.get<string>('EMBEDDING_BATCH_SIZE', '10'), 10);
    const embeddingBatchSize = Number.isFinite(batchParsed)
      ? Math.min(2048, Math.max(1, batchParsed))
      : 10;

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      model: this.config.get<string>('EMBEDDINGS_MODEL_NAME', 'text-embedding-v3'),
      configuration: {
        baseURL: this.config.get<string>('OPENAI_BASE_URL'),
      },
      dimensions: this.vectorDim,
      batchSize: embeddingBatchSize,
    });
  }

  /** 连接 Milvus；若集合不存在则创建索引并加载（便于首次上传即可用） */
  private async ensureMilvusLoaded(): Promise<void> {
    if (!this.milvusReady) {
      this.milvusReady = (async () => {
        await this.client.connectPromise;

        const has = await this.client.hasCollection({ collection_name: this.collectionName });
        if (!has.value) {
          await this.bootstrapEmptyCollection();
        }

        try {
          await this.client.loadCollection({ collection_name: this.collectionName });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes('already loaded')) {
            throw e;
          }
        }
      })();
    }
    await this.milvusReady;
  }

  private async bootstrapEmptyCollection(): Promise<void> {
    const dim = String(this.vectorDim);
    this.logger.log(`创建 Milvus 集合「${this.collectionName}」，向量维度 ${dim}（含 book_name，对齐 ebook-writer 脚本）`);

    const extractReason = (e: unknown): string => {
      if (e && typeof e === 'object' && 'reason' in e) return String((e as { reason?: string }).reason ?? '');
      if (e instanceof Error) return e.message;
      return String(e);
    };

    try {
      await this.client.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 256,
          },
          {
            name: 'book_id',
            data_type: DataType.VarChar,
            max_length: 512,
          },
          {
            name: 'book_name',
            data_type: DataType.VarChar,
            max_length: 512,
          },
          {
            name: 'chapter_num',
            data_type: DataType.Int64,
          },
          {
            name: 'index',
            data_type: DataType.Int64,
          },
          {
            name: 'content',
            data_type: DataType.VarChar,
            max_length: 65535,
          },
          {
            name: 'vector',
            data_type: DataType.FloatVector,
            type_params: { dim },
          },
        ],
      });
    } catch (e) {
      this.logger.error(e);
      throw new Error(`创建集合失败：${extractReason(e)}`);
    }

    try {
      await this.client.createIndex({
        collection_name: this.collectionName,
        field_name: 'vector',
        index_name: 'vector_cosine',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 1024 },
      });
    } catch (e) {
      this.logger.error(e);
      throw new Error(`创建向量索引失败：${extractReason(e)}`);
    }

    this.searchOutputFields = null;
  }

  private async resolveSearchOutputFields(): Promise<string[]> {
    if (this.searchOutputFields) return this.searchOutputFields;
    const desc = await this.client.describeCollection({ collection_name: this.collectionName });
    const fieldNames = new Set(
      (desc.schema?.fields ?? []).map((f: { name: string }) => f.name),
    );
    this.searchOutputFields = fieldNames.has('book_name')
      ? ['id', 'book_id', 'book_name', 'chapter_num', 'index', 'content']
      : ['id', 'book_id', 'chapter_num', 'index', 'content'];
    return this.searchOutputFields;
  }

  private throwSearchInfrastructureError(e: unknown): never {
    const msg = e instanceof Error ? e.message : String(e);
    this.logger.error(e);

    const addr = this.config.get<string>('MILVUS_ADDRESS', 'localhost:19530');
    if (msg.includes('CollectionNotExists') || msg.includes('collection not found')) {
      throw new BadRequestException(
        `Milvus 中不存在集合「${this.collectionName}」。请先上传文件入库，或检查 COLLECTION_NAME。`,
      );
    }
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('Deadline exceeded') ||
      msg.includes('failed to connect')
    ) {
      throw new BadRequestException(
        `无法连接 Milvus（${addr}）。请确认服务已启动，且 MILVUS_ADDRESS 配置正确。详情：${msg}`,
      );
    }

    throw new BadRequestException(`向量库操作失败：${msg}`);
  }

  /** 主键 ID：与 ebook-writer 一致 bookId_chapterNum_chunkIndex，超长则截断 bookId */
  private makeEpubChunkId(bookId: string, chapterNum: number, chunkIndex: number): string {
    const raw = `${bookId}_${chapterNum}_${chunkIndex}`;
    if (raw.length <= 256) return raw;
    const head = bookId.slice(0, 200);
    return `${head}_${chapterNum}_${chunkIndex}`.slice(0, 256);
  }

  private async insertMilvusRows(fields_data: MilvusInsertRow[]): Promise<void> {
    if (!fields_data.length) return;
    try {
      const ins = await this.client.insert({
        collection_name: this.collectionName,
        fields_data,
      });
      if (ins.status?.error_code && ins.status.error_code !== 'Success') {
        this.logger.error(ins);
        throw new BadRequestException(`Milvus 写入失败：${ins.status.reason ?? 'unknown'}`);
      }
      if (ins.err_index?.length) {
        this.logger.error(ins);
        throw new BadRequestException(`Milvus 部分行写入失败：${ins.status?.reason ?? 'unknown'}`);
      }
      await this.client.flush({ collection_names: [this.collectionName] });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.throwSearchInfrastructureError(e);
    }
  }

  /**
   * EPUB：按章节加载 → RecursiveCharacterTextSplitter(500/50) → 每章批量 embedding 并插入（对齐 ebook-writer.mjs）
   */
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
        const vectors = await this.embeddings.embedDocuments(chunks);
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
        await this.insertMilvusRows(fields_data);
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
   * 上传文件：解析 → 分块 → embedding → Milvus（.epub 走与 ebook-writer 相同的章节 + 500/50 策略）
   * `ingestLog`：分步说明，供前端展示入库感知
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
      await this.ensureMilvusLoaded();
    } catch (e) {
      this.throwSearchInfrastructureError(e);
    }

    log(`Milvus 集合「${this.collectionName}」已就绪`);
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
        vectors = await this.embeddings.embedDocuments(chunks);
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
      await this.insertMilvusRows(fields_data);

      results.push({ originalName: orig, bookId, chunks: chunks.length });
      totalChunks += chunks.length;
      log(`  完成：本文件 ${chunks.length} 条向量`);
    }

    log(`全部完成：合计 ${totalChunks} 条向量已写入「${this.collectionName}」`);

    return { totalChunks, collectionName: this.collectionName, results, ingestLog };
  }

  async search(query: string, topK: number): Promise<{ hits: VectorHitRow[] }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('缺少 OPENAI_API_KEY，无法对查询做 embedding');
    }

    try {
      await this.ensureMilvusLoaded();
    } catch (e) {
      this.throwSearchInfrastructureError(e);
    }

    let vector: number[];
    try {
      vector = await this.embeddings.embedQuery(query);
    } catch (e) {
      this.logger.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Embedding 调用失败：${msg}`);
    }

    const outputFields = await this.resolveSearchOutputFields();

    let searchResult: Awaited<ReturnType<MilvusClient['search']>>;
    try {
      searchResult = await this.client.search({
        collection_name: this.collectionName,
        vector,
        limit: topK,
        metric_type: MetricType.COSINE,
        output_fields: outputFields,
      });
    } catch (e) {
      this.throwSearchInfrastructureError(e);
    }

    const rows = searchResult.results ?? [];
    const hits: VectorHitRow[] = rows.map((item) => {
      const content = String(item.content ?? '');
      const bn = item.book_name != null && String(item.book_name).trim() !== '' ? String(item.book_name) : undefined;
      return {
        id: String(item.id ?? ''),
        score: typeof item.score === 'number' ? item.score : Number(item.score),
        book_id: String(item.book_id ?? ''),
        book_name: bn,
        chapter_num: Number(item.chapter_num ?? 0),
        index: Number(item.index ?? 0),
        contentPreview: content.length > 400 ? `${content.slice(0, 400)}…` : content,
      };
    });

    return { hits };
  }
}
