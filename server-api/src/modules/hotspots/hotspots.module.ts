import { Module } from '@nestjs/common';
import { CreateHotspotController } from './controllers/create-hotspot.controller';
import { UpdateHotspotController } from './controllers/update-hotspot.controller';
import { DeleteHotspotController } from './controllers/delete-hotspot.controller';
import { CreateHotspotService } from './services/create-hotspot.service';
import { UpdateHotspotService } from './services/update-hotspot.service';
import { DeleteHotspotService } from './services/delete-hotspot.service';

@Module({
  controllers: [CreateHotspotController, UpdateHotspotController, DeleteHotspotController],
  providers: [CreateHotspotService, UpdateHotspotService, DeleteHotspotService],
})
export class HotspotsModule {}
