import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FindVirtualTourService } from '../services/find-virtual-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class FindVirtualTourController {
  constructor(private readonly service: FindVirtualTourService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Retorna o tour completo com panoramas e hotspots' })
  findOne(@Param('id') id: string) {
    return this.service.execute(id);
  }
}
