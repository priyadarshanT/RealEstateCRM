import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/auth/decorators';
import { AssignmentService } from './assignment.service';
import { AssignmentRuleDto, AssignmentRuleInputDto, AssignmentRuleList, ReorderRulesDto } from './dto/rule.dto';

@ApiTags('Assignment')
@ApiBearerAuth('bearer')
@Controller('assignment-rules')
export class AssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  @Get()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listAssignmentRules', summary: 'List assignment rules' })
  @ApiOkResponse({ type: AssignmentRuleList })
  async list(): Promise<AssignmentRuleList> {
    return { data: await this.assignment.list() };
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createAssignmentRule', summary: 'Create an assignment rule' })
  @ApiCreatedResponse({ type: AssignmentRuleDto })
  create(@Body() body: AssignmentRuleInputDto): Promise<AssignmentRuleDto> {
    return this.assignment.create(body);
  }

  @Put('order')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'reorderAssignmentRules', summary: 'Reorder assignment rules' })
  @ApiNoContentResponse({ description: 'Done' })
  reorder(@Body() body: ReorderRulesDto): Promise<void> {
    return this.assignment.reorder(body.ruleIds);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateAssignmentRule', summary: 'Update an assignment rule' })
  @ApiOkResponse({ type: AssignmentRuleDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: AssignmentRuleInputDto): Promise<AssignmentRuleDto> {
    return this.assignment.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteAssignmentRule', summary: 'Delete an assignment rule' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assignment.delete(id);
  }
}
