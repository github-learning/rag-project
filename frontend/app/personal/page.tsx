'use client';

import Link from 'next/link';
import { PlusOutlined, SearchOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { Button, Card, Space, Typography, Upload, message } from 'antd';

const { Dragger } = Upload;

export default function PersonalPage() {
  // 上传配置
  const uploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    action: '/api/upload', // 👉 你后端接口
    onChange(info) {
      const { status, name } = info.file;

      if (status === 'uploading') {
        console.log('上传中:', name);
      }

      if (status === 'done') {
        message.success(`${name} 上传成功`);
      } else if (status === 'error') {
        message.error(`${name} 上传失败`);
      }
    },
    onDrop(e) {
      console.log('拖拽文件:', e.dataTransfer.files);
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
          上传文件示例（支持点击 & 拖拽）
        </Typography.Paragraph>

        {/* 上传卡片 */}
        <Card title="文件上传" className="shadow-sm">
          <Space direction="vertical" className="w-full">
            {/* 点击上传 */}
            <Upload {...uploadProps}>
              <Button icon={<PlusOutlined />}>点击上传</Button>
            </Upload>

            {/* 拖拽上传 */}
            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到这里上传</p>
              <p className="ant-upload-hint">支持单个或批量上传</p>
            </Dragger>
          </Space>
        </Card>

        {/* 原按钮示例 */}
        <Card title="Ant Design 按钮" className="shadow-sm mt-6">
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