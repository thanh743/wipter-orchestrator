import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ImportProxiesDto {
  @IsString()
  raw: string;

  @IsOptional()
  @IsString()
  labelPrefix?: string;

  @IsOptional()
  @IsBoolean()
  provision?: boolean = true;
}
