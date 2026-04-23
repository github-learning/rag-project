import { BadRequestException, Body, Controller, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { VectorSearchDto } from './dto/vector-search.dto';
import { VectorService } from './vector.service';

const ingestMulter = memoryStorage();

@Controller('vector')
export class VectorController {
  constructor(private readonly vector: VectorService) {}

  /** 语义检索：query → embedding → Milvus search → 返回命中片段 */
  @Post('search')
  async search(@Body() dto: VectorSearchDto) {
    const topK = dto.topK ?? 5;
    return this.vector.search(dto.query, topK);
  }

  /** 上传文件 → 解析分块 → 向量化 → 写入 Milvus（与问答检索同一集合） */
  @Post('ingest')
  @UseInterceptors(
    FilesInterceptor('files', 25, {
      storage: ingestMulter,
      limits: { fileSize: 35 * 1024 * 1024 },
    }),
  )
  async ingest(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('请选择至少一个文件');
    }
    return this.vector.ingestUploadedFiles(files);
  }
}
