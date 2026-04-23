import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { RagModule } from './modules/rag/rag.module';
import { VectorModule } from './modules/vector/vector.module';

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
