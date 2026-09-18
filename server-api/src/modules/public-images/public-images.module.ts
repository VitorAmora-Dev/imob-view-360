import { Module } from '@nestjs/common';
import { AuthorizePublicImageController } from './authorize-public-image.controller';
import { AuthorizePublicImageService } from './authorize-public-image.service';
import { PublicImageGatewayGuard } from './public-image-gateway.guard';

@Module({
  controllers: [AuthorizePublicImageController],
  providers: [AuthorizePublicImageService, PublicImageGatewayGuard],
})
export class PublicImagesModule {}
