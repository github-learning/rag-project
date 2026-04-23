import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { VectorService, type VectorHitRow } from '../vector/vector.service';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private chat: ChatOpenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly vector: VectorService,
  ) {}

  private getChatModel(): ChatOpenAI {
    if (!this.chat) {
      const apiKey = this.config.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new BadRequestException('缺少 OPENAI_API_KEY，无法调用大模型');
      }
      this.chat = new ChatOpenAI({
        temperature: 0.35,
        model: this.config.get<string>('MODEL_NAME', 'qwen-coder-turbo'),
        apiKey,
        configuration: {
          baseURL: this.config.get<string>('OPENAI_BASE_URL'),
        },
      });
    }
    return this.chat;
  }

  private buildContext(hits: VectorHitRow[]): string {
    return hits
      .map((h, i) => {
        const title = h.book_name?.trim() ? `《${h.book_name.trim()}》` : '';
        return `[片段 ${i + 1}] ${title ? `${title} · ` : ''}第 ${h.chapter_num} 章 · 相似度 ${h.score.toFixed(4)}\n${h.contentPreview}`;
      })
      .join('\n\n━━━━━\n\n');
  }

  /**
   * 先向量检索，再基于命中片段由大模型生成条理清晰的回答。
   */
  async answerWithRetrieval(query: string, topK: number): Promise<{ hits: VectorHitRow[]; answer: string }> {
    const { hits } = await this.vector.search(query, topK);

    if (hits.length === 0) {
      return {
        hits,
        answer: '没有在知识库中检索到与问题相关的片段，因此无法生成归纳回答。请尝试换一个问题或检查是否已写入向量数据。',
      };
    }

    const context = this.buildContext(hits);
    const prompt = `你是一个知识库问答助手。下面是从向量数据库检索到的若干文本片段（可能来自同一本书的不同位置）。

请严格依据这些片段回答用户问题，要求：
1. 条理清晰，可分点说明；必要时可标注「片段编号」对应依据。
2. 不要编造片段中不存在的情节或事实。
3. 若片段信息不足以完整回答，请明确说明「片段未涉及」的部分，不要猜测。

检索片段：
${context}

用户问题：
${query}

请用中文给出回答：`;

    try {
      const model = this.getChatModel();
      const res = await model.invoke(prompt);
      const content =
        typeof res.content === 'string' ? res.content : String((res as { content?: unknown }).content ?? '');
      return { hits, answer: content.trim() };
    } catch (e) {
      this.logger.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`大模型调用失败：${msg}`);
    }
  }
}
