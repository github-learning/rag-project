import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { RagModule } from './modules/rag/rag.module';
import { VectorModule } from './modules/vector/vector.module';

/** 编译后为 backend/dist，上一级为 backend，再上一级为 monorepo 根 */
const envFilePaths = [
  join(__dirname, '..', '..', '.env'),
  join(__dirname, '..', '..', '.env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '.env.local'),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths,
    }),
    VectorModule,
    RagModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
