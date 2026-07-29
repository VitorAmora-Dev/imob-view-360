import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RecordViewDto, RecordViewSchema } from '../dto/record-view.dto';
import { RecordViewService } from '../services/record-view.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class RecordViewController {
  constructor(private readonly service: RecordViewService) {}

  @Post(':id/views')
  @HttpCode(201)
  @ApiOperation({ summary: 'Registra uma visualização do tour' })
  record(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordViewSchema)) dto: RecordViewDto,
  ) {
    return this.service.execute(id, dto);
  }
}
