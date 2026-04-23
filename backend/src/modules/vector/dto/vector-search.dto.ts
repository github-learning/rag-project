import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class VectorSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}
