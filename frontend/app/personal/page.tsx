'use client';

import Link from 'next/link';
import { PlusOutlined, SearchOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { App, Button, Card, Space, Typography, Upload } from 'antd';
import { useCallback, useMemo, useState } from 'react';
import { getApiBase } from '@/lib/api-base';

const { Dragger } = Upload;

const ALLOWED_EXT = /\.(txt|md|pdf|docx|epub)$/i;

type IngestResponse = {
  totalChunks: number;
  collectionName: string;
  results: { originalName: string; bookId: string; chunks: number }[];
  ingestLog: string[];
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

export default function PersonalPage() {
  const { message } = App.useApp();
  const [ingestLogLines, setIngestLogLines] = useState<string[]>([]);

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
        onError?.(new Error('网络错误'));
      };

      xhr.onload = () => {
        let body: unknown;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          onError?.(new Error('响应解析失败'));
          return;
        }

        const b = body as {
          ingestLog?: string[];
          totalChunks?: number;
          message?: string | string[];
          statusCode?: number;
        };

        if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(b?.ingestLog)) {
          const res = body as IngestResponse;
          onSuccess?.(res, xhr);
          appendIngestLog(name, res.ingestLog);
          message.success(`${name} 已写入向量库（${res.totalChunks} 条）`);
          return;
        }

        const msg =
          typeof b?.message === 'string'
            ? b.message
            : Array.isArray(b?.message)
              ? b.message.join('；')
              : xhr.statusText || `HTTP ${xhr.status}`;
        onError?.(new Error(msg));
      };

      xhr.send(fd);
    },
    [appendIngestLog, message],
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
        message.error(`${name}：${errText}`);
      }
    },
    onDrop(e) {
      if (e.dataTransfer.files?.length) {
        console.log('拖拽文件:', e.dataTransfer.files);
      }
    },
  };

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-gray-800">
      <header className="border-b border-gray-200/80 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/" className="text-sm text-teal-600 hover:text-teal-500">
            返回首页
          </Link>
          <Link href="/knowledge" className="text-sm text-gray-500 hover:text-teal-600">
            智能问答
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <Typography.Title level={3} className="!mb-2">
          个人信息
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="!mb-6">
          将本地文件上传到向量库（与 Milvus 入库流程一致）。列表中会显示每个文件的
          HTTP 上传进度；解析、Embedding、写入 Milvus 在服务端完成，完成后下方会展示分步日志。
        </Typography.Paragraph>

        <Card title="文件上传 → 向量库" className="shadow-sm">
          <Space direction="vertical" className="w-full" size="middle">
            <Upload {...uploadProps}>
              <Button icon={<PlusOutlined />}>点击上传</Button>
            </Upload>

            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到这里上传</p>
              <p className="ant-upload-hint">支持 .txt / .md / .pdf / .docx / .epub，单文件或多文件</p>
            </Dragger>

            {ingestLogLines.length > 0 && (
              <div>
                <Typography.Text type="secondary" className="mb-1 block text-xs">
                  入库日志（与 ebook-writer 控制台风格一致，由后端 ingestLog 返回）
                </Typography.Text>
                <pre className="max-h-72 overflow-auto rounded border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700">
                  {ingestLogLines.join('\n')}
                </pre>
              </div>
            )}
          </Space>
        </Card>

        <Card title="Ant Design 按钮" className="mt-6 shadow-sm">
          <Space wrap size="middle">
            <Button type="primary">主要按钮</Button>
            <Button>默认按钮</Button>
            <Button type="dashed">虚线按钮</Button>
            <Button type="text">文本按钮</Button>
            <Button type="link">链接按钮</Button>
            <Button type="primary" icon={<PlusOutlined />} />
            <Button icon={<SearchOutlined />} aria-label="搜索" />
            <Button type="primary" disabled>
              禁用
            </Button>
          </Space>
        </Card>
      </main>
    </div>
  );
}
