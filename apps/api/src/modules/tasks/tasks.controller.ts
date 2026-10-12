import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { ActivityDto } from '../leads/dto/lead.dto';
import { CallLogDto, TaskCompleteDto, TaskCompleteResult, TaskDto, TaskInputDto, TaskListQuery, TaskPage } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth('bearer')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ operationId: 'listTasks', summary: 'Tasks and calendar' })
  @ApiOkResponse({ type: TaskPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: TaskListQuery): Promise<TaskPage> {
    return this.tasks.list(p, query);
  }

  @Post()
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'createTask', summary: 'Create a task' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: TaskDto })
  async create(@CurrentPrincipal() p: Principal, @Body() body: TaskInputDto): Promise<TaskDto> {
    return TaskDto.from(await this.tasks.create(p, body));
  }

  @Patch(':id')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'updateTask', summary: 'Update a task' })
  @ApiOkResponse({ type: TaskDto })
  async update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: TaskInputDto): Promise<TaskDto> {
    return TaskDto.from(await this.tasks.update(p, id, body));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'completeTask', summary: 'Complete a task' })
  @ApiOkResponse({ type: TaskCompleteResult })
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: TaskCompleteDto): Promise<TaskCompleteResult> {
    return this.tasks.complete(p, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'cancelTask', summary: 'Cancel a task' })
  @ApiOkResponse({ type: TaskDto })
  async cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    return TaskDto.from(await this.tasks.cancel(p, id));
  }
}

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller('leads')
export class LeadCallsController {
  constructor(private readonly tasks: TasksService) {}

  @Post(':id/calls')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'logCall', summary: 'Log a call' })
  @ApiCreatedResponse({ type: ActivityDto })
  logCall(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CallLogDto): Promise<ActivityDto> {
    return this.tasks.logCall(p, id, body);
  }
}
