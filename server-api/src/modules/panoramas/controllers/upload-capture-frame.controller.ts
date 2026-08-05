import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import {
  UploadCaptureFrameDto,
  UploadCaptureFrameSchema,
} from '../dto/upload-capture-frame.dto';
import { UploadCaptureFrameService } from '../services/upload-capture-frame.service';

@ApiTags('Panoramas')
@Controller('panoramas')
export class UploadCaptureFrameController {
  constructor(private readonly service: UploadCaptureFrameService) {}

  /**
   * Uma foto por requisição: um lote com a captura inteira passaria de 10 MB
   * num corpo só, e uma queda de rede levaria junto tudo o que já subiu.
   */
  @Post(':id/frames')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Guarda uma foto original da captura 360°' })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UploadCaptureFrameSchema)) dto: UploadCaptureFrameDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, dto, user);
  }
}
