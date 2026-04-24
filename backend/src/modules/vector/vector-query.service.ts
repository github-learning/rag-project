import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VectorEmbeddingService } from './vector-embedding.service';
import { VectorMilvusService } from './vector-milvus.service';
import type { VectorHitRow } from './vector.types';

@Injectable()
export class VectorQueryService {
  private readonly logger = new Logger(VectorQueryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly milvus: VectorMilvusService,
    private readonly embedding: VectorEmbeddingService,
  ) {}

  async search(query: string, topK: number): Promise<{ hits: VectorHitRow[] }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('缺少 OPENAI_API_KEY，无法对查询做 embedding');
    }

    try {
      await this.milvus.ensureMilvusLoaded();
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
    }

    let vector: number[];
    try {
      vector = await this.embedding.embedQuery(query);
    } catch (e) {
      this.logger.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Embedding 调用失败：${msg}`);
    }

    const outputFields = await this.milvus.resolveSearchOutputFields();

    let searchResult: Awaited<ReturnType<VectorMilvusService['searchByVector']>>;
    try {
      searchResult = await this.milvus.searchByVector(vector, topK, outputFields);
    } catch (e) {
      this.milvus.throwInfrastructureError(e);
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
