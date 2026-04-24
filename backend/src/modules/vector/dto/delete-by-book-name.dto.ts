import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteByBookNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  bookName!: string;
}
