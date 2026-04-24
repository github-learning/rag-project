/** 单条向量检索命中（与 Milvus 输出及 @rag/shared 对齐） */
export type VectorHitRow = {
  id: string;
  score: number;
  book_id: string;
  /** 书名（EPUB / 入库脚本对齐字段，可为空） */
  book_name?: string;
  chapter_num: number;
  index: number;
  contentPreview: string;
};

/** Milvus insert 行结构 */
export type MilvusInsertRow = {
  id: string;
  book_id: string;
  book_name: string;
  chapter_num: number;
  index: number;
  content: string;
  vector: number[];
};

/** Milvus：单次 query 的 offset + limit 不得超过此值（max query result window） */
export const MILVUS_MAX_QUERY_WINDOW = 16384;
