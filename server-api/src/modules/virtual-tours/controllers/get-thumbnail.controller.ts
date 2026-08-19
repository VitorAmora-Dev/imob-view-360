import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GetThumbnailService } from '../services/get-thumbnail.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class GetThumbnailController {
  constructor(private readonly service: GetThumbnailService) {}

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Capa do tour, reduzida para tamanho de card' })
  async getThumbnail(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const { etag, corpo } = await this.service.execute(id, ifNoneMatch);

    // O ETag vai nos dois caminhos: no 304 ele é o que confirma qual versão o
    // cliente pode continuar usando.
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (!corpo) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(corpo);
  }
}
