'use client';

import Link from 'next/link';
import { KnowledgeBasePanel } from '@/components/knowledge-base-panel';

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
        <KnowledgeBasePanel variant="page" />
      </main>
    </div>
  );
}
