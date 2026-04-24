import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class VectorEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(VectorEmbeddingService.name);
  private embeddings!: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY 未设置：向量检索将无法计算 query embedding');
    }

    const vectorDim = Number(this.config.get<string>('VECTOR_DIM', '1024'));
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
      dimensions: vectorDim,
      batchSize: embeddingBatchSize,
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
