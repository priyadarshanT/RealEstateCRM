import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/auth/decorators';
import { CurrencyCodes, CurrencyList, SetCurrenciesDto, SettingDto, SettingList, UpdateSettingDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth('bearer')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listSettings', summary: 'List settings' })
  @ApiOkResponse({ type: SettingList })
  async list(): Promise<SettingList> {
    return { data: await this.settings.list() };
  }

  @Put('settings/:key')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateSetting', summary: 'Change a setting' })
  @ApiOkResponse({ type: SettingDto })
  update(@Param('key') key: string, @Body() body: UpdateSettingDto): Promise<SettingDto> {
    return this.settings.update(key, body.value);
  }

  @Get('currencies')
  @ApiOperation({ operationId: 'listEnabledCurrencies', summary: 'Enabled currencies' })
  @ApiOkResponse({ type: CurrencyList })
  async currencies(): Promise<CurrencyList> {
    return { data: await this.settings.listCurrencies() };
  }

  @Put('currencies')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'setEnabledCurrenciesAndRates', summary: 'Set enabled currencies and rates' })
  @ApiOkResponse({ type: CurrencyCodes })
  async setCurrencies(@Body() body: SetCurrenciesDto): Promise<CurrencyCodes> {
    return { data: await this.settings.setCurrencies(body) };
  }
}
