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

@Module({
  controllers: [
    CreatePanoramaController,
    UpdatePanoramaController,
    DeletePanoramaController,
    UploadCaptureFrameController,
  ],
  providers: [
    CreatePanoramaService,
    UpdatePanoramaService,
    DeletePanoramaService,
    UploadCaptureFrameService,
    TreatPanoramaService,
  ],
  exports: [TreatPanoramaService],
})
export class PanoramasModule {}
