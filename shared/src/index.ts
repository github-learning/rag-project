/** 前后端共用的向量检索契约（与 Milvus 集合字段对齐） */
export interface VectorHit {
  id: string;
  score: number;
  book_id: string;
  /** 书名（与 ebook-writer / EPUB 入库一致，可选） */
  book_name?: string;
  chapter_num: number;
  index: number;
  contentPreview: string;
}

export interface VectorSearchRequest {
  query: string;
  /** 1–50，默认 5 */
  topK?: number;
}

export interface VectorSearchResponse {
  hits: VectorHit[];
}

/** 检索命中 + 大模型归纳后的回答 */
export interface RagAnswerResponse extends VectorSearchResponse {
  answer: string;
}
