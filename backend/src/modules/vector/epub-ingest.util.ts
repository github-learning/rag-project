import { EPubLoader } from '@langchain/community/document_loaders/fs/epub';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/** 与 milvus-test/ebook-writer.mjs 一致：500 字块、50 重叠 */
export const EPUB_CHUNK_SIZE = 500;
export const EPUB_CHUNK_OVERLAP = 50;

/**
 * 从 EPUB 文件路径加载；splitChapters=true 时每章一条正文（与 ebook-writer 相同）
 */
export async function loadEpubChapterTexts(epubFilePath: string): Promise<string[]> {
  const loader = new EPubLoader(epubFilePath, { splitChapters: true });
  const documents = await loader.load();
  return documents.map((d) => d.pageContent).filter((t) => t.trim().length > 0);
}

export function createEpubTextSplitter(): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter({
    chunkSize: EPUB_CHUNK_SIZE,
    chunkOverlap: EPUB_CHUNK_OVERLAP,
  });
}
