import { Body, Controller, Get, Headers, Param, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermission } from '../../core/auth/decorators';
import { parseIfMatch } from '../../core/http/etag';
import { ClientPolicyDto, CurrencyCodes, CurrencyList, SetCurrenciesDto, SettingChangeList, SettingDto, SettingList, UpdateSettingDto } from './dto/settings.dto';
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

  @Get('settings/:key')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'getSetting', summary: 'Get a setting' })
  @ApiOkResponse({ type: SettingDto })
  async get(@Param('key') key: string, @Res({ passthrough: true }) res: Response): Promise<SettingDto> {
    const setting = await this.settings.one(key);
    res.setHeader('ETag', SettingsService.etag(setting));
    return setting;
  }

  @Put('settings/:key')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateSetting', summary: 'Change a setting' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: SettingDto })
  async update(
    @Param('key') key: string,
    @Body() body: UpdateSettingDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SettingDto> {
    const setting = await this.settings.update(key, body.value, parseIfMatch(ifMatch));
    res.setHeader('ETag', SettingsService.etag(setting));
    return setting;
  }

  @Get('settings/:key/history')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listSettingHistory', summary: 'Change history of a setting' })
  @ApiOkResponse({ type: SettingChangeList })
  async history(@Param('key') key: string): Promise<SettingChangeList> {
    return { data: await this.settings.history(key) };
  }

  @Get('client-policy')
  @ApiOperation({ operationId: 'getClientPolicy', summary: 'Global Configuration switches for the screens' })
  @ApiOkResponse({ type: ClientPolicyDto })
  clientPolicy(): Promise<ClientPolicyDto> {
    return this.settings.clientPolicy();
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
