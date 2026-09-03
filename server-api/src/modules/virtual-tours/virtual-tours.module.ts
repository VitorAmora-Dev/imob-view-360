import { Module } from '@nestjs/common';
import { CreateVirtualTourController } from './controllers/create-virtual-tour.controller';
import { DeleteVirtualTourController } from './controllers/delete-virtual-tour.controller';
import { FindDraftTourController } from './controllers/find-draft-tour.controller';
import { FindEditableTourController } from './controllers/find-editable-tour.controller';
import { FindVirtualTourController } from './controllers/find-virtual-tour.controller';
import { GetAnalyticsController } from './controllers/get-analytics.controller';
import { GetThumbnailController } from './controllers/get-thumbnail.controller';
import { RecordShareController } from './controllers/record-share.controller';
import { RecordViewController } from './controllers/record-view.controller';
import { UpdateVirtualTourController } from './controllers/update-virtual-tour.controller';
import { CreateVirtualTourService } from './services/create-virtual-tour.service';
import { DeleteVirtualTourService } from './services/delete-virtual-tour.service';
import { FindDraftTourService } from './services/find-draft-tour.service';
import { FindEditableTourService } from './services/find-editable-tour.service';
import { FindVirtualTourService } from './services/find-virtual-tour.service';
import { GetAnalyticsService } from './services/get-analytics.service';
import { GetThumbnailService } from './services/get-thumbnail.service';
import { RecordShareService } from './services/record-share.service';
import { RecordViewService } from './services/record-view.service';
import { UpdateVirtualTourService } from './services/update-virtual-tour.service';
import { MontarTourController } from './controllers/montar-tour.controller';
import { MontarTourService } from './services/montar-tour.service';
import { ListDraftToursController } from './controllers/list-draft-tours.controller';
import { ListDraftToursService } from './services/list-draft-tours.service';
import { PanoramasModule } from '../panoramas/panoramas.module';

@Module({
  // Pelo TreatPanoramaService, de que o MontarTourService depende: o
  // `POST /virtual-tours/:id/montar` é quem enfileira a etapa de IA, depois de
  // as fotos originais da captura terem subido.
  imports: [PanoramasModule],
  controllers: [
    CreateVirtualTourController,
    DeleteVirtualTourController,
    UpdateVirtualTourController,
    // Antes do FindVirtualTourController: `@Get()` precisa ser resolvido antes
    // do `@Get(':id')`, ou `GET /virtual-tours` cai na rota de parâmetro.
    ListDraftToursController,
    FindVirtualTourController,
    // `@Get(':id/rascunho')` tem sufixo: não disputa nem com o `@Get()` acima
    // nem com o `@Get(':id')` do FindVirtualTourController, então a ordem
    // aqui é livre.
    FindDraftTourController,
    // Mesmo argumento do vizinho acima: `@Get(':id/edicao')` tem sufixo e não
    // disputa com o `@Get(':id')`.
    FindEditableTourController,
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
    FindDraftTourService,
    FindEditableTourService,
    GetThumbnailService,
    RecordViewService,
    RecordShareService,
    GetAnalyticsService,
    MontarTourService,
    ListDraftToursService,
  ],
})
export class VirtualToursModule {}
