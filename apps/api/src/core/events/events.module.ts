import { Global, Module } from '@nestjs/common';
import { EventBus } from './domain-events';

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
