import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * 兼容 monorepo 根目录与 backend 包目录两种 cwd。
 * `pnpm --filter @rag/backend start:dev` 时 cwd 多为 `.../rag-project/backend`，
 * 此时 `.env` 若在仓库根 `.../rag-project/.env`，必须额外加载上一级目录。
 * 后加载的文件会覆盖同名变量（override: true）。
 */
function envFileCandidates(): string[] {
  const cwd = process.cwd();
  const files: string[] = [];

  if (basename(cwd) === 'backend') {
    files.push(resolve(cwd, '..', '.env'), resolve(cwd, '..', '.env.local'));
  }

  files.push(
    resolve(cwd, '.env'),
    resolve(cwd, '.env.local'),
    resolve(cwd, 'backend', '.env'),
    resolve(cwd, 'backend', '.env.local'),
  );

  return files;
}

export function loadEnvFiles(): void {
  for (const file of envFileCandidates()) {
    if (existsSync(file)) {
      config({ path: file, override: true });
    }
  }
}

loadEnvFiles();
