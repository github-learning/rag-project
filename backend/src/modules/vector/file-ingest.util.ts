import mammoth from 'mammoth';
import { basename, parse } from 'node:path';

/**
 * Multer 常把 multipart 里 UTF-8 文件名按 latin1 读成乱码；若原文无汉字而 latin1→utf8 后出现汉字，则用转码结果。
 */
export function normalizeUploadOriginalname(name: string): string {
  if (!name) return name;
  let candidate: string;
  try {
    candidate = Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
  if (candidate.includes('\uFFFD')) return name;
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  if (/[\u4e00-\u9fff]/.test(candidate)) return candidate;
  return name;
}

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
    // pdf-parse@2 为 PDFParse + getText()；v1 的 pdf(buffer) 已不可用
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse') as {
      PDFParse: new (opts: { data: Buffer }) => {
        getText: () => Promise<{ text?: string }>;
        destroy: () => Promise<void>;
      };
    };
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`UNSUPPORTED_TYPE:${originalname}`);
}

export function makeBookIdFromFilename(filename: string): string {
  const normalized = normalizeUploadOriginalname(filename);
  const base = normalized.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_').slice(0, 120);
  return `${Date.now()}_${base || 'upload'}`;
}

/** 从上传文件名取书名（去扩展名），对齐 ebook-writer 的 BOOK_NAME */
export function bookTitleFromOriginalName(originalname: string): string {
  const name = basename(normalizeUploadOriginalname(originalname));
  return parse(name).name || name;
}
