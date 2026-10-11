import { ApiProperty } from '@nestjs/swagger';
import { TenantDto } from './tenant.dto';
import { UserDto } from './user.dto';

// components.schemas.Me
export class MeDto {
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiProperty({ type: TenantDto }) tenant!: TenantDto;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ enum: ['own', 'team', 'division', 'company'] }) dataScope!: 'own' | 'team' | 'division' | 'company';
}
