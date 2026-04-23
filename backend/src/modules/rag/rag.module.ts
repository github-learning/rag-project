import { Module } from '@nestjs/common';
import { VectorModule } from '../vector/vector.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [VectorModule],
  controllers: [RagController],
  providers: [RagService],
})
export class RagModule {}
