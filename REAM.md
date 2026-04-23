好的，所有文件都看完了。下面给你做一个完整的、详细的梳理。

---

## 一、项目总体架构

这是一个 **pnpm monorepo** 项目，由三个包组成：

```
rag-project/
├── shared/      (@rag/shared)   —— 前后端共享的 TypeScript 类型定义
├── backend/     (@rag/backend)  —— NestJS 后端，连接 Milvus + 大模型
├── frontend/    (@rag/frontend) —— Next.js 前端，调用后端 API 展示结果
├── package.json                 —— 根 monorepo 脚本（concurrently 并发启动前后端）
└── pnpm-workspace.yaml          —— 声明三个工作区包
```

启动方式：根目录执行 `pnpm dev`，会用 `concurrently` 同时启动后端（3001 端口）和前端（3000 端口）。

---

## 二、shared 包 —— 类型契约

`@rag/shared` 没有编译步骤，直接导出 TypeScript 源文件。前端通过 `workspace:*` 依赖引用它。

```1:18:shared/src/index.ts
/** 前后端共用的向量检索契约（与 Milvus 集合字段对齐） */
export interface VectorHit {
  id: string;
  score: number;
  book_id: string;
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
```

定义了三个核心接口：
- **`VectorHit`** — 单条向量检索命中结果，包含相似度分数、书籍 ID、章节号、内容预览等
- **`VectorSearchRequest`** — 检索请求参数（`query` + 可选 `topK`）
- **`RagAnswerResponse`** — 继承 `VectorSearchResponse`，多了一个 `answer` 字段（大模型归纳回答）

---

## 三、Backend 后端 —— 完整链路

### 3.1 启动流程

```1:3:backend/src/main.ts
import './load-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
```

1. **加载环境变量**（`load-env.ts`）：兼容 monorepo，按优先级从多个路径加载 `.env` / `.env.local`，后加载的覆盖先加载的
2. **创建 NestJS 应用**
3. **启用 CORS**：`app.enableCors({ origin: true })`，允许前端跨域调用
4. **全局 ValidationPipe**：自动校验 DTO，`whitelist: true` 过滤未定义字段，`transform: true` 自动类型转换
5. **全局路由前缀**：`app.setGlobalPrefix('api')`，所有接口都挂在 `/api` 下
6. **监听端口**：默认 3001，可通过 `PORT_BACKEND` 环境变量修改

### 3.2 模块结构

```7:19:backend/src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    VectorModule,
    RagModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- **AppModule** — 根模块，导入 `ConfigModule`（全局配置）、`VectorModule`、`RagModule`
- **VectorModule** — 向量检索能力，导出 `VectorService` 供 `RagModule` 使用
- **RagModule** — RAG 问答能力，依赖 `VectorModule`

### 3.3 AppController — 根路由

```1:25:backend/src/app.controller.ts
@Controller()
export class AppController {
  @Get()
  root() {
    return {
      ok: true,
      service: '@rag/backend',
      // ... 列出所有可用端点
    };
  }

  @Get('health')
  health() {
    return { ok: true, service: '@rag/backend' };
  }
}
```

提供两个辅助端点：
- `GET /api` — 返回 API 说明和所有可用端点列表
- `GET /api/health` — 健康检查

### 3.4 VectorService — 向量检索核心

这是整个系统的核心，负责与 **Milvus 向量数据库** 交互。

**初始化阶段**（`onModuleInit`）：

```28:47:backend/src/modules/vector/vector.service.ts
  onModuleInit() {
    const address = this.config.get<string>('MILVUS_ADDRESS', 'localhost:19530');
    this.collectionName = this.config.get<string>('COLLECTION_NAME', 'ebook_collection');
    this.vectorDim = Number(this.config.get<string>('VECTOR_DIM', '1024'));

    this.client = new MilvusClient({ address });

    // ...

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      model: this.config.get<string>('EMBEDDINGS_MODEL_NAME', 'text-embedding-v3'),
      configuration: {
        baseURL: this.config.get<string>('OPENAI_BASE_URL'),
      },
      dimensions: this.vectorDim,
    });
  }
```

- 连接 Milvus（默认 `localhost:19530`）
- 使用 `@langchain/openai` 的 `OpenAIEmbeddings` 做 embedding（通过阿里云 DashScope 兼容接口，模型 `text-embedding-v3`，维度 1024）

**搜索流程**（`search` 方法）：

```68:98:backend/src/modules/vector/vector.service.ts
  async search(query: string, topK: number): Promise<{ hits: VectorHitRow[] }> {
    // 1. 检查 API Key
    // 2. 确保 Milvus collection 已加载
    await this.ensureMilvusLoaded();
    // 3. 将用户查询文本转为向量
    const vector = await this.embeddings.embedQuery(query);
    // 4. 在 Milvus 中做余弦相似度搜索
    const searchResult = await this.client.search({
      collection_name: this.collectionName,
      vector,
      limit: topK,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'book_id', 'chapter_num', 'index', 'content'],
    });
    // 5. 格式化结果，content 超过 400 字截断
    // ...
  }
```

流程：`用户文本 → Embedding 向量 → Milvus 余弦相似度搜索 → 返回 topK 条结果`

### 3.5 VectorController — 纯向量检索接口

```1:16:backend/src/modules/vector/vector.controller.ts
@Controller('vector')
export class VectorController {
  constructor(private readonly vector: VectorService) {}

  @Post('search')
  async search(@Body() dto: VectorSearchDto) {
    const topK = dto.topK ?? 5;
    return this.vector.search(dto.query, topK);
  }
}
```

- `POST /api/vector/search` — 纯向量检索，只返回命中片段，不调用大模型（前端目前没调用这个接口）

### 3.6 RagService — RAG 问答核心

```46:83:backend/src/modules/rag/rag.service.ts
  async answerWithRetrieval(query: string, topK: number) {
    // 1. 先做向量检索
    const { hits } = await this.vector.search(query, topK);

    // 2. 如果没命中，直接返回提示
    if (hits.length === 0) {
      return { hits, answer: '没有在知识库中检索到...' };
    }

    // 3. 构建上下文（把所有命中片段拼接起来）
    const context = this.buildContext(hits);

    // 4. 拼装 prompt，包含检索片段 + 用户问题 + 指令
    const prompt = `你是一个知识库问答助手...`;

    // 5. 调用大模型生成回答
    const model = this.getChatModel();
    const res = await model.invoke(prompt);

    // 6. 返回 { hits, answer }
    return { hits, answer: content.trim() };
  }
```

大模型配置（`getChatModel`）：
- 使用 `@langchain/openai` 的 `ChatOpenAI`
- 通过 DashScope 兼容接口（`OPENAI_BASE_URL`）
- 默认模型 `qwen-coder-turbo`，temperature 0.35
- Prompt 中要求模型：分点回答、标注片段编号、不编造、信息不足要明说

### 3.7 RagController — RAG 接口

```1:15:backend/src/modules/rag/rag.controller.ts
@Controller('rag')
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post('answer')
  async answer(@Body() dto: VectorSearchDto) {
    const topK = dto.topK ?? 5;
    return this.rag.answerWithRetrieval(dto.query, topK);
  }
}
```

- `POST /api/rag/answer` — 前端实际调用的接口

### 3.8 DTO 校验

```1:15:backend/src/modules/vector/dto/vector-search.dto.ts
export class VectorSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}
```

- `query`：必填，1~4000 字符
- `topK`：可选，1~50 整数

---

## 四、Frontend 前端

### 4.1 布局与样式

- 使用 **Tailwind CSS v4**，深色主题（`bg-slate-950 text-slate-100`）
- `layout.tsx` 设置了 `lang="zh-CN"`，标题 "RAG Project"

### 4.2 首页（`/`）

纯展示页，提供一个链接跳转到知识库检索页面。

### 4.3 知识库检索页面（`/knowledge`）

这是前端唯一有业务逻辑的页面，`'use client'` 标记为客户端组件。

**状态管理**：

```9:14:frontend/app/knowledge/page.tsx
  const [query, setQuery] = useState('鸠摩智会什么武功？');
  const [topK, setTopK] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RagAnswerResponse | null>(null);
```

**核心调用函数 `runRag()`**：

```16:36:frontend/app/knowledge/page.tsx
  async function runRag() {
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`${getApiBase()}/rag/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), topK }),
      });
      // ... 错误处理和类型断言
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
```

**UI 渲染**：
1. **输入区域**：文本域（查询语句）+ topK 数字输入 + 提交按钮
2. **错误提示**：红色边框卡片
3. **AI 归纳区域**：绿色主题卡片，用 `react-markdown` + `remark-gfm` 渲染 Markdown 格式的回答
4. **引用片段列表**：逐条展示命中的向量检索结果，显示章节号、索引、相似度分数、内容预览

---

## 五、完整数据流

```
┌──────────────── 前端 (Next.js :3000) ─────────────────┐
│                                                        │
│  用户输入: "鸠摩智会什么武功？"  topK: 3               │
│         │                                              │
│         ▼                                              │
│  fetch POST http://localhost:3001/api/rag/answer       │
│  body: { query: "鸠摩智会什么武功？", topK: 3 }        │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │ HTTP (CORS enabled)
                         ▼
┌──────────────── 后端 (NestJS :3001) ───────────────────┐
│                                                        │
│  1. ValidationPipe 校验 DTO                            │
│         │                                              │
│  2. RagController.answer()                             │
│         │                                              │
│  3. RagService.answerWithRetrieval(query, topK)        │
│         │                                              │
│         ├── 4a. VectorService.search()                 │
│         │      │                                       │
│         │      ├── OpenAI Embeddings (DashScope)       │
│         │      │   text-embedding-v3, dim=1024         │
│         │      │   "鸠摩智会什么武功？" → [0.12, ...]  │
│         │      │                                       │
│         │      ├── Milvus 向量检索                     │
│         │      │   collection: ebook_collection        │
│         │      │   metric: COSINE, limit: 3            │
│         │      │                                       │
│         │      └── 返回 hits: VectorHitRow[]           │
│         │                                              │
│         ├── 4b. 拼装 Prompt                            │
│         │      "你是一个知识库问答助手..."              │
│         │      + 检索到的片段作为上下文                 │
│         │      + 用户问题                              │
│         │                                              │
│         ├── 4c. ChatOpenAI (DashScope)                 │
│         │      model: qwen-coder-turbo                 │
│         │      temperature: 0.35                       │
│         │                                              │
│         └── 返回 { hits, answer }                      │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌──────────────── 前端渲染结果 ──────────────────────────┐
│                                                        │
│  ┌─ AI 归纳 ──────────────────────────────────────┐    │
│  │ 鸠摩智精通多种武功：                            │    │
│  │ 1. 火焰刀...                                   │    │
│  │ 2. 小无相功...                                  │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  ┌─ 引用片段 ─────────────────────────────────────┐    │
│  │ #1 · 章节 12 · score 0.8734                    │    │
│  │ "鸠摩智使出火焰刀..."                          │    │
│  ├────────────────────────────────────────────────┤    │
│  │ #2 · 章节 8  · score 0.8521                    │    │
│  │ "鸠摩智以小无相功..."                          │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 六、环境变量汇总

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT_BACKEND` | `3001` | 后端端口 |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus 地址 |
| `COLLECTION_NAME` | `ebook_collection` | Milvus 集合名 |
| `VECTOR_DIM` | `1024` | 向量维度 |
| `OPENAI_API_KEY` | (必填) | DashScope/OpenAI API 密钥 |
| `OPENAI_BASE_URL` | DashScope 地址 | Embedding + Chat 的 API 网关 |
| `EMBEDDINGS_MODEL_NAME` | `text-embedding-v3` | Embedding 模型 |
| `MODEL_NAME` | `qwen-coder-turbo` | 归纳回答用的对话模型 |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:3001/api` | 前端访问后端的基址 |

---

## 七、后端暴露的 API 总览

| 方法 | 路径 | 说明 | 前端是否调用 |
|------|------|------|-------------|
| `GET` | `/api` | API 说明页 | 否 |
| `GET` | `/api/health` | 健康检查 | 否 |
| `POST` | `/api/vector/search` | 纯向量检索（只返回 hits） | 否 |
| `POST` | `/api/rag/answer` | 向量检索 + 大模型归纳 | **是** |

前端目前只调用了 `POST /api/rag/answer` 这一个接口，`/api/vector/search` 虽然后端实现了但前端没有使用。