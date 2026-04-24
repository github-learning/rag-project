import { Body, Controller, Post } from '@nestjs/common';
import { RagAnswerDto, RagAnswerModeEnum } from './dto/rag-answer.dto';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly rag: RagService) {}

  /**
   * 向量检索 + 大模型归纳。
   * - quick（默认）：单次检索 + 生成；可用 topK。
   * - deep：规划子查询 → 多轮检索 → 去重合并 → 综合生成。
   */
  @Post('answer')
  async answer(@Body() dto: RagAnswerDto) {
    const mode = dto.mode ?? RagAnswerModeEnum.quick;
    if (mode === RagAnswerModeEnum.deep) {
      return this.rag.answerWithDeepAgent(dto.query);
    }
    const topK = dto.topK ?? 5;
    return this.rag.answerWithRetrieval(dto.query, topK);
  }
}
