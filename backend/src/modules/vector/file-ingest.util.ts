import mammoth from 'mammoth';
import { basename, parse } from 'node:path';

/** 将正文切成适合向量化的片段（按长度 + 尽量在句号/换行处断开） */
export function chunkText(text: string, maxLen = 900, overlap = 120): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxLen, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('. '));
      if (lastBreak > maxLen * 0.35) {
        end = start + lastBreak + 1;
      }
    }
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export async function extractTextFromBuffer(buffer: Buffer, originalname: string): Promise<string> {
  const lower = originalname.toLowerCase();

  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buffer.toString('utf-8');
  }

  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value ?? '';
  }

  if (lower.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text?: string }>;
    const data = await pdfParse(buffer);
    return data.text ?? '';
  }

  throw new Error(`UNSUPPORTED_TYPE:${originalname}`);
}

export function makeBookIdFromFilename(filename: string): string {
  const base = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_').slice(0, 120);
  return `${Date.now()}_${base || 'upload'}`;
}

/** 从上传文件名取书名（去扩展名），对齐 ebook-writer 的 BOOK_NAME */
export function bookTitleFromOriginalName(originalname: string): string {
  const name = basename(originalname);
  return parse(name).name || name;
}
