'use client';

import type { ReactNode } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={zhCN}>
        {/* 提供 message / notification / modal 等静态方法的上下文（antd 5+） */}
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
