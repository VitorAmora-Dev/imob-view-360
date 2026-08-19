import { Module } from '@nestjs/common';
import { CreatePanoramaController } from './controllers/create-panorama.controller';
import { UpdatePanoramaController } from './controllers/update-panorama.controller';
import { DeletePanoramaController } from './controllers/delete-panorama.controller';
import { UploadCaptureFrameController } from './controllers/upload-capture-frame.controller';
import { CreatePanoramaService } from './services/create-panorama.service';
import { UpdatePanoramaService } from './services/update-panorama.service';
import { DeletePanoramaService } from './services/delete-panorama.service';
import { UploadCaptureFrameService } from './services/upload-capture-frame.service';
import { TreatPanoramaService } from './services/treat-panorama.service';
import { GetPanoramaImageController } from './controllers/get-panorama-image.controller';
import { GetPanoramaImageService } from './services/get-panorama-image.service';
import { PanoramaImageReader } from './panorama-image.reader';

@Module({
  controllers: [
    CreatePanoramaController,
    UpdatePanoramaController,
    DeletePanoramaController,
    UploadCaptureFrameController,
    GetPanoramaImageController,
  ],
  providers: [
    CreatePanoramaService,
    UpdatePanoramaService,
    DeletePanoramaService,
    UploadCaptureFrameService,
    TreatPanoramaService,
    GetPanoramaImageService,
    PanoramaImageReader,
  ],
  // O `PanoramaImageReader` sai daqui porque a capa do tour, que mora em
  // virtual-tours, lê imagem pela mesma regra — e duas cópias da regra
  // divergiriam em silêncio.
  exports: [TreatPanoramaService, PanoramaImageReader],
})
export class PanoramasModule {}
