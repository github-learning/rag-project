import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** 访问 http://localhost:3001/api 时返回说明（不是 404） */
  @Get()
  root() {
    return {
      ok: true,
      service: '@rag/backend',
      hint: '本服务没有单独的「页面」，只有 JSON API。',
      endpoints: {
        health: { method: 'GET', path: '/api/health' },
        vectorLibrary: { method: 'GET', path: '/api/vector/library', note: '按 book_id 聚合知识库列表' },
        vectorConflicts: {
          method: 'GET',
          path: '/api/vector/conflicts?filename=',
          note: '上传前按书名键检测是否已存在',
        },
        vectorDeleteByBookName: {
          method: 'POST',
          path: '/api/vector/library/delete-by-book-name',
          body: { bookName: 'string' },
        },
        vectorSearch: { method: 'POST', path: '/api/vector/search', body: { query: 'string', topK: 'number?' } },
        vectorIngest: {
          method: 'POST',
          path: '/api/vector/ingest',
          body: 'multipart/form-data，字段 files（可多文件）',
        },
        ragAnswer: {
          method: 'POST',
          path: '/api/rag/answer',
          body: {
            query: 'string',
            mode: 'quick | deep，可选，默认 quick',
            topK: 'number?，仅 quick 生效',
            agentTrace: '响应可选：subQueries、retrievalRounds、mergedChunkCount（深度模式）',
          },
        },
      },
    };
  }

  @Get('health')
  health() {
    return { ok: true, service: '@rag/backend' };
  }
}
