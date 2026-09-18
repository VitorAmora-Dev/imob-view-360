import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  GetPanoramaImageDto,
  GetPanoramaImageSchema,
} from '../dto/get-panorama-image.dto';
import { GetPanoramaImageService } from '../services/get-panorama-image.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class GetPanoramaImageController {
  constructor(private readonly service: GetPanoramaImageService) {}

  @Get(':id/image')
  @ApiOperation({ summary: 'JPEG do panorama, de tour publicado' })
  @ApiQuery({
    name: 'w',
    required: false,
    description: 'Largura em px; sem isto, tamanho original',
  })
  @ApiQuery({
    name: 'v',
    required: false,
    description: 'Versão, só para o cache do navegador',
  })
  async getImage(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetPanoramaImageSchema))
    query: GetPanoramaImageDto,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    // A URL da API continua acessível mesmo com o gateway ativo. Não permita
    // que um cache externo pule a checagem de PUBLISHED após ocultar/apagar.
    res.setHeader('Cache-Control', 'no-store');
    const { etag, corpo } = await this.service.execute(id, {
      largura: query.w,
      etagDoCliente: ifNoneMatch,
    });

    res.setHeader('ETag', etag);

    if (!corpo) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(corpo);
  }
}
