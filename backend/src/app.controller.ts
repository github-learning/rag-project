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
        vectorSearch: { method: 'POST', path: '/api/vector/search', body: { query: 'string', topK: 'number?' } },
        vectorIngest: {
          method: 'POST',
          path: '/api/vector/ingest',
          body: 'multipart/form-data，字段 files（可多文件）',
        },
        ragAnswer: { method: 'POST', path: '/api/rag/answer', body: { query: 'string', topK: 'number?' } },
      },
    };
  }

  @Get('health')
  health() {
    return { ok: true, service: '@rag/backend' };
  }
}
