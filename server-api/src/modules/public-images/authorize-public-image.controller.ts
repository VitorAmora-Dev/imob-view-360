import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthorizePublicImageService } from './authorize-public-image.service';
import { PublicImageGatewayGuard } from './public-image-gateway.guard';

const Schema = z.strictObject({ key: z.string().max(128) });

@Controller('internal/public-images')
export class AuthorizePublicImageController {
  constructor(private readonly service: AuthorizePublicImageService) {}

  @Post('authorize')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PublicImageGatewayGuard)
  // IPs de saída do Worker são compartilhados. O segredo é checado antes de
  // consultar o banco; rate limiting/WAF do gateway é configurado na Cloudflare.
  @SkipThrottle()
  async authorize(
    @Body(new ZodValidationPipe(Schema)) body: z.infer<typeof Schema>,
  ) {
    await this.service.execute(body.key);
  }
}
