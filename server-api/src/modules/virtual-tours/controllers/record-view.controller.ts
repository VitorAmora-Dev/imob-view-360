import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RECORD_VIEW_THROTTLE } from '../../../config/throttle.config';
import { RecordViewDto, RecordViewSchema } from '../dto/record-view.dto';
import { RecordViewService } from '../services/record-view.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class RecordViewController {
  constructor(private readonly service: RecordViewService) {}

  @Post(':id/views')
  @HttpCode(201)
  @Throttle(RECORD_VIEW_THROTTLE)
  @ApiOperation({ summary: 'Registra uma visualização do tour' })
  @ApiTooManyRequestsResponse({ description: 'Muitos registros em sequência' })
  record(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordViewSchema)) dto: RecordViewDto,
  ) {
    return this.service.execute(id, dto);
  }
}
