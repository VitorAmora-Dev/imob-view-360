import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GetThumbnailService } from '../services/get-thumbnail.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class GetThumbnailController {
  constructor(private readonly service: GetThumbnailService) {}

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Retorna o thumbnail do primeiro panorama do tour' })
  async getThumbnail(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.execute(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  }
}
