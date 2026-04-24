import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export enum RagAnswerModeEnum {
  quick = 'quick',
  deep = 'deep',
}

export class RagAnswerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  query!: string;

  /** 快速：单次检索 + 回答；深度：规划子查询 → 多轮检索 → 综合回答 */
  @IsOptional()
  @IsEnum(RagAnswerModeEnum)
  mode?: RagAnswerModeEnum;

  /** 仅 quick 模式生效；默认 5 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}
