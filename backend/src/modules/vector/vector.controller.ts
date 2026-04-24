import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { DeleteByBookNameDto } from './dto/delete-by-book-name.dto';
import { VectorSearchDto } from './dto/vector-search.dto';
import { VectorIngestService } from './vector-ingest.service';
import { VectorLibraryService } from './vector-library.service';
import { VectorQueryService } from './vector-query.service';

const ingestMulter = memoryStorage();

@Controller('vector')
export class VectorController {
  constructor(
    private readonly vectorIngest: VectorIngestService,
    private readonly vectorQuery: VectorQueryService,
    private readonly vectorLibrary: VectorLibraryService,
  ) {}

  /** 按文件名解析出的「书名键」查询是否已有同名入库（用于上传前提示） */
  @Get('conflicts')
  async conflicts(@Query('filename') filename: string) {
    if (!filename?.trim()) {
      throw new BadRequestException('缺少查询参数 filename');
    }
    return this.vectorLibrary.findUploadConflicts(filename);
  }

  /** 知识库中已有哪些书（按 book_id 聚合条数） */
  @Get('library')
  async library() {
    return this.vectorLibrary.listKnowledgeLibrary();
  }

  /** 按书名删除 Milvus 中全部向量（覆盖上传前调用） */
  @Post('library/delete-by-book-name')
  async deleteByBookName(@Body() dto: DeleteByBookNameDto) {
    return this.vectorLibrary.deleteVectorsByBookName(dto.bookName);
  }

  /** 语义检索：query → embedding → Milvus search → 返回命中片段 */
  @Post('search')
  async search(@Body() dto: VectorSearchDto) {
    const topK = dto.topK ?? 5;
    return this.vectorQuery.search(dto.query, topK);
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
    return this.vectorIngest.ingestUploadedFiles(files);
  }
}
