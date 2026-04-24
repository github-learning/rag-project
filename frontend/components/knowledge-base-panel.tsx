'use client';

import { PlusOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { App, Button, Card, Radio, Space, Table, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '@/lib/api-base';

const { Dragger } = Upload;

const ALLOWED_EXT = /\.(txt|md|pdf|docx|epub)$/i;

type IngestResponse = {
  totalChunks: number;
  collectionName: string;
  results: { originalName: string; bookId: string; chunks: number }[];
  ingestLog: string[];
};

type LibraryBook = {
  bookId: string;
  bookName: string;
  chunkCount: number;
};

type LibraryResponse = {
  books: LibraryBook[];
  truncated: boolean;
  collectionName: string;
};

type ConflictsResponse = {
  titleKey: string;
  existing: LibraryBook[];
  canMatchByBookName: boolean;
};

type CustomRequestOptions = Parameters<NonNullable<UploadProps['customRequest']>>[0];

function resolveUploadPayload(file: CustomRequestOptions['file']): { raw: File | Blob; name: string } {
  if (typeof file === 'string') {
    throw new Error('不支持路径字符串上传');
  }
  if (file instanceof File || file instanceof Blob) {
    return { raw: file, name: file instanceof File ? file.name : 'file' };
  }
  const uf = file as UploadFile;
  if (uf.originFileObj) {
    return {
      raw: uf.originFileObj,
      name: uf.name || uf.originFileObj.name || 'file',
    };
  }
  throw new Error('缺少可上传的文件数据');
}

function ingestWithXhr(
  raw: File | Blob,
  name: string,
  callbacks: Pick<CustomRequestOptions, 'onSuccess' | 'onError' | 'onProgress'>,
): Promise<IngestResponse> {
  const { onSuccess, onError, onProgress } = callbacks;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('files', raw, name);
    const url = `${getApiBase()}/vector/ingest`;
    xhr.open('POST', url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress?.({ percent });
      }
    };

    xhr.onerror = () => {
      const err = new Error('网络错误');
      onError?.(err);
      reject(err);
    };

    xhr.onload = () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        const err = new Error('响应解析失败');
        onError?.(err);
        reject(err);
        return;
      }

      const b = body as {
        ingestLog?: string[];
        totalChunks?: number;
        message?: string | string[];
      };

      if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(b?.ingestLog)) {
        const res = body as IngestResponse;
        onSuccess?.(res, xhr);
        resolve(res);
        return;
      }

      const msg =
        typeof b?.message === 'string'
          ? b.message
          : Array.isArray(b?.message)
            ? b.message.join('；')
            : xhr.statusText || `HTTP ${xhr.status}`;
      const err = new Error(msg);
      onError?.(err);
      reject(err);
    };

    xhr.send(fd);
  });
}

export type KnowledgeBasePanelProps = {
  /** 嵌入问答页时收紧排版 */
  variant?: 'page' | 'embedded';
  className?: string;
};

export function KnowledgeBasePanel({ variant = 'page', className = '' }: KnowledgeBasePanelProps) {
  const { message, modal } = App.useApp();
  const [ingestLogLines, setIngestLogLines] = useState<string[]>([]);
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [libraryMeta, setLibraryMeta] = useState<{ collectionName: string; truncated: boolean } | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const overwriteChoiceRef = useRef<'overwrite' | 'add'>('add');
  const embedded = variant === 'embedded';

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/vector/library`);
      const body = (await r.json()) as LibraryResponse & { message?: string };
      if (!r.ok) {
        throw new Error(typeof body.message === 'string' ? body.message : `HTTP ${r.status}`);
      }
      setLibrary(body.books ?? []);
      setLibraryMeta({
        collectionName: body.collectionName ?? '',
        truncated: Boolean(body.truncated),
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载知识库列表失败');
    } finally {
      setLibraryLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const appendIngestLog = useCallback((fileLabel: string, lines: string[]) => {
    setIngestLogLines((prev) => [...prev, '', `—— ${fileLabel} ——`, ...lines]);
  }, []);

  const customRequest = useMemo<NonNullable<UploadProps['customRequest']>>(
    () => (options) => {
      const { file, onSuccess, onError, onProgress } = options;
      let raw: File | Blob;
      let name: string;
      try {
        ({ raw, name } = resolveUploadPayload(file));
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      const api = getApiBase();

      void (async () => {
        try {
          const confRes = await fetch(`${api}/vector/conflicts?filename=${encodeURIComponent(name)}`);
          const confBody = (await confRes.json()) as ConflictsResponse & { message?: string };
          if (!confRes.ok) {
            throw new Error(typeof confBody.message === 'string' ? confBody.message : `HTTP ${confRes.status}`);
          }

          const runUpload = () =>
            ingestWithXhr(raw, name, { onSuccess, onError, onProgress }).then(async (res) => {
              appendIngestLog(name, res.ingestLog);
              message.success(`${name} 已写入向量库（${res.totalChunks} 条）`);
              await refreshLibrary();
            });

          if (!confBody.canMatchByBookName || confBody.existing.length === 0) {
            await runUpload();
            return;
          }

          const totalVec = confBody.existing.reduce((s, x) => s + x.chunkCount, 0);
          overwriteChoiceRef.current = 'add';

          await new Promise<void>((resolve, reject) => {
            modal.confirm({
              title: `知识库已有「${confBody.titleKey}」`,
              width: 560,
              content: (
                <div className="space-y-3 pt-1">
                  <Typography.Paragraph type="secondary" className="!mb-0 text-sm">
                    与当前文件名解析出的书名一致的数据已存在（共 {confBody.existing.length} 个 book_id、约{' '}
                    {totalVec} 条向量）。请选择本次上传方式：
                  </Typography.Paragraph>
                  <Radio.Group
                    defaultValue="add"
                    onChange={(e) => {
                      overwriteChoiceRef.current = e.target.value as 'overwrite' | 'add';
                    }}
                  >
                    <Space vertical size="small">
                      <Radio value="add">保留旧版，再入库一版（会多一套向量，检索可能重复命中）</Radio>
                      <Radio value="overwrite">
                        覆盖：先删除库内该书名的全部向量，再上传当前文件
                      </Radio>
                    </Space>
                  </Radio.Group>
                </div>
              ),
              okText: '继续上传',
              cancelText: '取消',
              onOk: async () => {
                try {
                  if (overwriteChoiceRef.current === 'overwrite') {
                    const del = await fetch(`${api}/vector/library/delete-by-book-name`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ bookName: confBody.titleKey }),
                    });
                    const delJson = (await del.json().catch(() => ({}))) as { message?: string | string[] };
                    if (!del.ok) {
                      const m =
                        typeof delJson.message === 'string'
                          ? delJson.message
                          : Array.isArray(delJson.message)
                            ? delJson.message.join('；')
                            : await del.text();
                      throw new Error(m || '按书名删除失败');
                    }
                    message.success(`已删除「${confBody.titleKey}」在库中的旧向量`);
                  }
                  await runUpload();
                  resolve();
                } catch (e) {
                  const err = e instanceof Error ? e : new Error(String(e));
                  onError?.(err);
                  throw err;
                }
              },
              onCancel: () => {
                onError?.(new Error('已取消上传'));
                reject(new Error('cancel'));
              },
            });
          });
        } catch (e) {
          if ((e as Error)?.message !== 'cancel') {
            const err = e instanceof Error ? e : new Error(String(e));
            onError?.(err);
          }
        }
      })();
    },
    [appendIngestLog, message, modal, refreshLibrary],
  );

  const libraryColumns: ColumnsType<LibraryBook> = useMemo(
    () => [
      {
        title: '书名（来自文件名）',
        dataIndex: 'bookName',
        key: 'bookName',
        ellipsis: true,
        render: (t: string) => t || '—',
      },
      {
        title: '向量条数',
        dataIndex: 'chunkCount',
        key: 'chunkCount',
        width: embedded ? 88 : 110,
      },
      {
        title: 'book_id',
        dataIndex: 'bookId',
        key: 'bookId',
        ellipsis: true,
        render: (id: string) => <span className="font-mono text-xs text-gray-600">{id}</span>,
      },
    ],
    [embedded],
  );

  const uploadProps: UploadProps = {
    name: 'files',
    multiple: true,
    customRequest,
    beforeUpload(file) {
      if (!ALLOWED_EXT.test(file.name.toLowerCase())) {
        message.warning('仅支持 .txt、.md、.pdf、.docx、.epub');
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    onChange(info) {
      const { status, name } = info.file;
      if (status === 'error') {
        const errText =
          info.file.error instanceof Error ? info.file.error.message : '上传或入库失败';
        if (errText !== '已取消上传') {
          message.error(`${name}：${errText}`);
        }
      }
    },
    onDrop(e) {
      if (e.dataTransfer.files?.length) {
        console.log('拖拽文件:', e.dataTransfer.files);
      }
    },
  };

  const cardCls = embedded ? 'shadow-sm [&_.ant-card-head]:min-h-10 [&_.ant-card-head-title]:py-2 [&_.ant-card-head-title]:text-sm' : 'shadow-sm';

  return (
    <div className={`space-y-4 ${className}`}>
      {!embedded && (
        <>
          <Typography.Title level={3} className="!mb-2">
            个人信息
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="!mb-0">
            将本地文件上传到向量库。上传前会按<strong>文件名解析出的书名</strong>与库中{' '}
            <code className="text-xs">book_name</code> 比对；若已存在，可选择覆盖或保留旧版再新增一版。下方列表展示当前库内已聚合的文档。
          </Typography.Paragraph>
        </>
      )}
      {embedded && (
        <p className="text-xs leading-relaxed text-gray-500">
          上传文档写入向量库后，左侧问答即可检索。支持覆盖或保留旧版再入库。
        </p>
      )}

      <Card
        title="已入库文档"
        className={cardCls}
        size={embedded ? 'small' : 'default'}
        extra={
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void refreshLibrary()}>
            刷新
          </Button>
        }
      >
        {libraryMeta?.truncated && (
          <Typography.Paragraph type="warning" className="!mb-2 text-xs">
            数据量较大，列表可能未扫全（已截断）；仍以 Milvus 为准。
          </Typography.Paragraph>
        )}
        <Typography.Text type="secondary" className="mb-2 block text-xs">
          集合：{libraryMeta?.collectionName ?? '—'} · 按 book_id 汇总条数
        </Typography.Text>
        <Table<LibraryBook>
          size="small"
          rowKey="bookId"
          loading={libraryLoading}
          columns={libraryColumns}
          dataSource={library}
          pagination={{ pageSize: embedded ? 6 : 8, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无入库文档，请先上传文件' }}
          scroll={embedded ? { x: 'max-content' } : undefined}
        />
      </Card>

      <Card title="上传文件" className={cardCls} size={embedded ? 'small' : 'default'}>
        <Space vertical className="w-full" size="middle">
          {!embedded && (
            <Upload {...uploadProps}>
              <Button icon={<PlusOutlined />}>点击上传</Button>
            </Upload>
          )}

          <Dragger {...uploadProps} className={embedded ? '[&_.ant-upload-drag-container]:py-4' : undefined}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{embedded ? '点击或拖拽上传' : '点击或拖拽文件到这里上传'}</p>
            <p className="ant-upload-hint text-xs">.txt / .md / .pdf / .docx / .epub</p>
          </Dragger>

          {ingestLogLines.length > 0 && (
            <div>
              <Typography.Text type="secondary" className="mb-1 block text-xs">
                入库日志
              </Typography.Text>
              <pre
                className={`overflow-auto rounded border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 ${
                  embedded ? 'max-h-40' : 'max-h-72'
                }`}
              >
                {ingestLogLines.join('\n')}
              </pre>
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}
