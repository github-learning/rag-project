import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-bold text-gray-800">武侠世界智能问答</h1>
      <p className="mt-3 max-w-md text-center text-gray-500">
        基于 Milvus 向量检索 + 大模型归纳，从武侠小说知识库中查找最相关的内容并生成回答。
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          className="rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
          href="/knowledge"
        >
          开始提问
        </Link>
        <Link
          className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-teal-300 hover:text-teal-700"
          href="/personal"
        >
          个人信息
        </Link>
      </div>
    </main>
  );
}
