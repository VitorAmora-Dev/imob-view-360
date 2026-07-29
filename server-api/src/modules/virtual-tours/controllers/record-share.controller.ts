import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RecordShareDto, RecordShareSchema } from '../dto/record-share.dto';
import { RecordShareService } from '../services/record-share.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class RecordShareController {
  constructor(private readonly service: RecordShareService) {}

  @Post(':id/shares')
  @HttpCode(201)
  @ApiOperation({ summary: 'Registra um compartilhamento do tour' })
  record(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordShareSchema)) dto: RecordShareDto,
  ) {
    return this.service.execute(id, dto);
  }
}
