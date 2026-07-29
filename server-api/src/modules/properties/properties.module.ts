import { Module } from '@nestjs/common';
import { CreatePropertyController } from './controllers/create-property.controller';
import { DeletePropertyController } from './controllers/delete-property.controller';
import { ListPropertiesController } from './controllers/list-properties.controller';
import { FindPropertyController } from './controllers/find-property.controller';
import { CreatePropertyService } from './services/create-property.service';
import { DeletePropertyService } from './services/delete-property.service';
import { ListPropertiesService } from './services/list-properties.service';
import { FindPropertyService } from './services/find-property.service';

@Module({
  controllers: [CreatePropertyController, DeletePropertyController, ListPropertiesController, FindPropertyController],
  providers: [CreatePropertyService, DeletePropertyService, ListPropertiesService, FindPropertyService],
})
export class PropertiesModule {}
