import { Module } from '@nestjs/common';
import { CreateVirtualTourController } from './controllers/create-virtual-tour.controller';
import { DeleteVirtualTourController } from './controllers/delete-virtual-tour.controller';
import { FindVirtualTourController } from './controllers/find-virtual-tour.controller';
import { GetAnalyticsController } from './controllers/get-analytics.controller';
import { GetThumbnailController } from './controllers/get-thumbnail.controller';
import { RecordShareController } from './controllers/record-share.controller';
import { RecordViewController } from './controllers/record-view.controller';
import { UpdateVirtualTourController } from './controllers/update-virtual-tour.controller';
import { CreateVirtualTourService } from './services/create-virtual-tour.service';
import { DeleteVirtualTourService } from './services/delete-virtual-tour.service';
import { FindVirtualTourService } from './services/find-virtual-tour.service';
import { GetAnalyticsService } from './services/get-analytics.service';
import { GetThumbnailService } from './services/get-thumbnail.service';
import { RecordShareService } from './services/record-share.service';
import { RecordViewService } from './services/record-view.service';
import { UpdateVirtualTourService } from './services/update-virtual-tour.service';
import { MontarTourController } from './controllers/montar-tour.controller';
import { MontarTourService } from './services/montar-tour.service';
import { PanoramasModule } from '../panoramas/panoramas.module';

@Module({
  // Pelo TreatPanoramaService: salvar um tour cria os panoramas aqui dentro, e é
  // daqui que a etapa de IA precisa ser agendada.
  imports: [PanoramasModule],
  controllers: [
    CreateVirtualTourController,
    DeleteVirtualTourController,
    UpdateVirtualTourController,
    FindVirtualTourController,
    GetThumbnailController,
    RecordViewController,
    RecordShareController,
    GetAnalyticsController,
    MontarTourController,
  ],
  providers: [
    CreateVirtualTourService,
    DeleteVirtualTourService,
    UpdateVirtualTourService,
    FindVirtualTourService,
    GetThumbnailService,
    RecordViewService,
    RecordShareService,
    GetAnalyticsService,
    MontarTourService,
  ],
})
export class VirtualToursModule {}
