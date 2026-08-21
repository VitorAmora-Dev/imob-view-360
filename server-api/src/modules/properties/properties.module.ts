import { Module } from '@nestjs/common';
import { CreatePropertyController } from './controllers/create-property.controller';
import { DeletePropertyController } from './controllers/delete-property.controller';
import { ListPropertiesController } from './controllers/list-properties.controller';
import { FindPropertyController } from './controllers/find-property.controller';
import { UpdatePropertyController } from './controllers/update-property.controller';
import { CreatePropertyService } from './services/create-property.service';
import { DeletePropertyService } from './services/delete-property.service';
import { ListPropertiesService } from './services/list-properties.service';
import { FindPropertyService } from './services/find-property.service';
import { UpdatePropertyService } from './services/update-property.service';

@Module({
  controllers: [
    CreatePropertyController,
    DeletePropertyController,
    ListPropertiesController,
    FindPropertyController,
    UpdatePropertyController,
  ],
  providers: [
    CreatePropertyService,
    DeletePropertyService,
    ListPropertiesService,
    FindPropertyService,
    UpdatePropertyService,
  ],
})
export class PropertiesModule {}
