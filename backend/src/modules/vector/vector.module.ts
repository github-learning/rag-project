import { Module } from '@nestjs/common';
import { VectorController } from './vector.controller';
import { VectorEmbeddingService } from './vector-embedding.service';
import { VectorIngestService } from './vector-ingest.service';
import { VectorLibraryService } from './vector-library.service';
import { VectorMilvusService } from './vector-milvus.service';
import { VectorQueryService } from './vector-query.service';

@Module({
  controllers: [VectorController],
  providers: [
    VectorMilvusService,
    VectorEmbeddingService,
    VectorIngestService,
    VectorQueryService,
    VectorLibraryService,
  ],
  exports: [VectorQueryService],
})
export class VectorModule {}
