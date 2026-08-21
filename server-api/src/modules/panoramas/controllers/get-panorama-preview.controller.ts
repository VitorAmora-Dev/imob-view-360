import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  GetPanoramaPreviewDto,
  GetPanoramaPreviewSchema,
} from '../dto/get-panorama-preview.dto';
import { GetPanoramaPreviewService } from '../services/get-panorama-preview.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class GetPanoramaPreviewController {
  constructor(private readonly service: GetPanoramaPreviewService) {}

  @Get(':id/preview')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'JPEG do panorama para quem edita o tour, inclusive em rascunho',
  })
  @ApiQuery({
    name: 'variant',
    required: false,
    description:
      'treated (padrão, cai na original se ainda não tratou) ou original',
  })
  @ApiQuery({ name: 'w', required: false, description: 'Largura em px' })
  @ApiQuery({
    name: 'v',
    required: false,
    description: 'Versão, só para o cache',
  })
  async getPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(GetPanoramaPreviewSchema))
    query: GetPanoramaPreviewDto,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { etag, corpo } = await this.service.execute(id, user, {
      variante: query.variant,
      largura: query.w,
      etagDoCliente: ifNoneMatch,
    });

    res.setHeader('ETag', etag);
    // `private`: a resposta depende do token de quem pediu, e um cache
    // compartilhado que a guardasse a entregaria para outra imobiliária. Curto
    // porque, durante a captura, a imagem tratada substitui a original em
    // segundos — e é essa troca que o wizard existe para mostrar.
    res.setHeader('Cache-Control', 'private, max-age=60');

    if (!corpo) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(corpo);
  }
}
