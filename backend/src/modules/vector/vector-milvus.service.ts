import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataType, MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
import type { MilvusInsertRow } from './vector.types';

@Injectable()
export class VectorMilvusService implements OnModuleInit {
  private readonly logger = new Logger(VectorMilvusService.name);
  private client!: MilvusClient;
  private collectionName!: string;
  private vectorDim!: number;
  private milvusReady: Promise<void> | null = null;
  /** describeCollection 缓存：旧库可能无 book_name */
  private searchOutputFields: string[] | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const address = this.config.get<string>('MILVUS_ADDRESS', 'localhost:19530');
    this.collectionName = this.config.get<string>('COLLECTION_NAME', 'ebook_collection');
    this.vectorDim = Number(this.config.get<string>('VECTOR_DIM', '1024'));
    this.client = new MilvusClient({ address });
  }

  getCollectionName(): string {
    return this.collectionName;
  }

  /** Milvus 布尔表达式里双引号字符串转义 */
  escapeStringForExpr(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  throwInfrastructureError(e: unknown): never {
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

  async ensureMilvusLoaded(): Promise<void> {
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

  async resolveSearchOutputFields(): Promise<string[]> {
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

  async insertRows(fields_data: MilvusInsertRow[]): Promise<void> {
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
      this.throwInfrastructureError(e);
    }
  }

  async searchByVector(
    vector: number[],
    topK: number,
    outputFields: string[],
  ): Promise<Awaited<ReturnType<MilvusClient['search']>>> {
    return this.client.search({
      collection_name: this.collectionName,
      vector,
      limit: topK,
      metric_type: MetricType.COSINE,
      output_fields: outputFields,
    });
  }

  async queryScalar(params: {
    filter: string;
    output_fields: string[];
    limit: number;
    offset: number;
  }): Promise<{ status?: { error_code?: string | number; reason?: string }; data?: Record<string, unknown>[] }> {
    return this.client.query({
      collection_name: this.collectionName,
      filter: params.filter,
      output_fields: params.output_fields,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async deleteByFilter(filter: string): Promise<void> {
    const del = await this.client.delete({
      collection_name: this.collectionName,
      filter,
    });
    const code = del.status?.error_code;
    if (code !== undefined && code !== 'Success' && code !== 0 && String(code) !== '0') {
      const reason = del.status?.reason ?? String(code);
      throw new BadRequestException(`Milvus 删除失败：${reason}`);
    }
    await this.client.flush({ collection_names: [this.collectionName] });
  }
}
