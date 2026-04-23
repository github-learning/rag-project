'use client';

import Link from 'next/link';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Space, Typography } from 'antd';

export default function PersonalPage() {
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
          以下为 Ant Design <code>Button</code> 在本页的用法示例。
        </Typography.Paragraph>

        <Card title="Ant Design 按钮" className="shadow-sm">
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
