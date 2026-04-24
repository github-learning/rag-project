import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { VectorQueryService } from '../vector/vector-query.service';
import type { VectorHitRow } from '../vector/vector.types';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private chat: ChatOpenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly vectorQuery: VectorQueryService,
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

  /** 多轮检索结果按 id 去重，保留更高相似度，再截断条数 */
  private mergeHitsById(all: VectorHitRow[], maxChunks: number): VectorHitRow[] {
    const byId = new Map<string, VectorHitRow>();
    for (const h of all) {
      const prev = byId.get(h.id);
      if (!prev || h.score > prev.score) {
        byId.set(h.id, h);
      }
    }
    return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, maxChunks);
  }

  /**
   * 从模型输出中解析 JSON 字符串数组（子查询）。失败时返回空数组，由调用方回退为单条原问题。
   */
  private parseSubQueryList(raw: string): string[] {
    const text = raw.trim();
    const code = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (code ? code[1] : text).trim();
    const tryParse = (s: string): string[] | null => {
      try {
        const v = JSON.parse(s) as unknown;
        if (!Array.isArray(v)) return null;
        const out = v.map((x) => String(x).trim()).filter((s) => s.length > 0);
        return out.length ? out : null;
      } catch {
        return null;
      }
    };
    let list = tryParse(candidate);
    if (!list) {
      const bracket = candidate.match(/\[[\s\S]*\]/);
      if (bracket) list = tryParse(bracket[0]);
    }
    if (!list) return [];
    const maxQ = Number(this.config.get<string>('DEEP_AGENT_MAX_SUBQUERIES', '5'));
    const cap = Number.isFinite(maxQ) ? Math.min(8, Math.max(3, maxQ)) : 5;
    return list.slice(0, cap);
  }

  /**
   * 深度模式第一步：由模型将用户问题拆成若干可独立检索的子问题。
   */
  private async planRetrievalSubQueries(userQuery: string): Promise<string[]> {
    const prompt = `你是检索规划助手。用户问题可能涉及多条线索、多个角色或需要对比、归纳，请拆成若干条**简短的、可独立做向量检索**的中文子问题。

硬性要求：
1. 只输出一个 JSON 数组，不要 markdown、不要解释。例如：["乔峰与慕容复是否交手过","聚贤庄大战涉及哪些人物"]
2. 数组长度 3～5，条目互不重复，尽量覆盖问题的不同侧面。
3. 每条是一整句或短语即可，不要编号前缀。

用户问题：
${userQuery}`;

    try {
      const model = this.getChatModel();
      const res = await model.invoke(prompt);
      const content =
        typeof res.content === 'string' ? res.content : String((res as { content?: unknown }).content ?? '');
      const subs = this.parseSubQueryList(content);
      if (subs.length >= 1) {
        this.logger.log(`深度模式规划子查询 ${subs.length} 条: ${subs.join(' | ')}`);
        return subs;
      }
    } catch (e) {
      this.logger.warn(`规划子查询失败，回退为单轮原问：${e instanceof Error ? e.message : e}`);
    }
    return [userQuery];
  }

  /**
   * 快速：单次向量检索 + 一次生成。
   */
  async answerWithRetrieval(
    query: string,
    topK: number,
  ): Promise<{ hits: VectorHitRow[]; answer: string; agentTrace: { mode: 'quick'; mergedChunkCount: number } }> {
    const { hits } = await this.vectorQuery.search(query, topK);

    if (hits.length === 0) {
      return {
        hits,
        answer: '没有在知识库中检索到与问题相关的片段，因此无法生成归纳回答。请尝试换一个问题或检查是否已写入向量数据。',
        agentTrace: { mode: 'quick', mergedChunkCount: 0 },
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
      return {
        hits,
        answer: content.trim(),
        agentTrace: { mode: 'quick', mergedChunkCount: hits.length },
      };
    } catch (e) {
      this.logger.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`大模型调用失败：${msg}`);
    }
  }

  /**
   * 深度：规划子查询 → 每子查询向量检索 → 去重合并 → 综合生成（多章节 / 多线索）。
   */
  async answerWithDeepAgent(query: string): Promise<{
    hits: VectorHitRow[];
    answer: string;
    agentTrace: {
      mode: 'deep';
      subQueries: string[];
      retrievalRounds: number;
      mergedChunkCount: number;
    };
  }> {
    const perRoundK = Number(this.config.get<string>('DEEP_AGENT_TOPK_PER_SUBQUERY', '4'));
    const topKEach = Number.isFinite(perRoundK) ? Math.min(12, Math.max(2, perRoundK)) : 4;
    const maxMerged = Number(this.config.get<string>('DEEP_AGENT_MAX_CHUNKS', '24'));
    const mergedCap = Number.isFinite(maxMerged) ? Math.min(48, Math.max(8, maxMerged)) : 24;

    const subQueries = await this.planRetrievalSubQueries(query);
    const pooled: VectorHitRow[] = [];

    for (const sq of subQueries) {
      try {
        const { hits } = await this.vectorQuery.search(sq, topKEach);
        pooled.push(...hits);
      } catch (e) {
        this.logger.warn(`子查询检索跳过：${sq} — ${e instanceof Error ? e.message : e}`);
      }
    }

    const merged = this.mergeHitsById(pooled, mergedCap);

    if (merged.length === 0) {
      return {
        hits: [],
        answer: '多轮检索后仍未找到与问题相关的片段，请尝试换一种问法或检查知识库是否已入库。',
        agentTrace: {
          mode: 'deep',
          subQueries,
          retrievalRounds: subQueries.length,
          mergedChunkCount: 0,
        },
      };
    }

    const context = this.buildContext(merged);
    const prompt = `你是资深知识库分析助手。下面的文本片段来自**多轮、多角度向量检索**，可能跨章节、跨情节线，信息比单次检索更散、更全。

你的任务：
1. **综合**多片段信息，理清因果、对比、时间线或人物关系（若片段中有依据）。
2. 像审阅材料的「总工」一样组织答案：可先给结论或总览，再分点展开；引用依据时请标注对应 **[片段 n]**。
3. 严格基于片段，不编造；若片段之间矛盾或不足，请指出「片段未覆盖」或「信息冲突」，不要臆测补全。
4. 用中文作答，结构清晰，可使用小标题。

检索片段（已去重、按相关度排序）：
${context}

用户原始问题：
${query}

请用中文给出深度综合分析：`;

    try {
      const model = this.getChatModel();
      const res = await model.invoke(prompt);
      const content =
        typeof res.content === 'string' ? res.content : String((res as { content?: unknown }).content ?? '');
      return {
        hits: merged,
        answer: content.trim(),
        agentTrace: {
          mode: 'deep',
          subQueries,
          retrievalRounds: subQueries.length,
          mergedChunkCount: merged.length,
        },
      };
    } catch (e) {
      this.logger.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`大模型调用失败：${msg}`);
    }
  }
}
