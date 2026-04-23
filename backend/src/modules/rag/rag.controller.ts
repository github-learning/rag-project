import { Body, Controller, Post } from '@nestjs/common';
import { VectorSearchDto } from '../vector/dto/vector-search.dto';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly rag: RagService) {}

  /**
   * 向量检索 + 大模型归纳（一次请求返回 hits 与 answer）
   */
  @Post('answer')
  async answer(@Body() dto: VectorSearchDto) {
    const topK = dto.topK ?? 5;
    return this.rag.answerWithRetrieval(dto.query, topK);
  }
}
