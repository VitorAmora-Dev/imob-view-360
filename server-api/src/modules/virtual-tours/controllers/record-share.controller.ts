import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RECORD_SHARE_THROTTLE } from '../../../config/throttle.config';
import { RecordShareDto, RecordShareSchema } from '../dto/record-share.dto';
import { RecordShareService } from '../services/record-share.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class RecordShareController {
  constructor(private readonly service: RecordShareService) {}

  @Post(':id/shares')
  @HttpCode(201)
  @Throttle(RECORD_SHARE_THROTTLE)
  @ApiOperation({ summary: 'Registra um compartilhamento do tour' })
  @ApiTooManyRequestsResponse({ description: 'Muitos registros em sequência' })
  record(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordShareSchema)) dto: RecordShareDto,
  ) {
    return this.service.execute(id, dto);
  }
}
