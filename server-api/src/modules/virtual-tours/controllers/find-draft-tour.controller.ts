import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { FindDraftTourService } from '../services/find-draft-tour.service';

@ApiTags('Virtual Tours')
@Controller('virtual-tours')
export class FindDraftTourController {
  constructor(private readonly service: FindDraftTourService) {}

  @Get(':id/rascunho')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Tour completo para reidratar o wizard, inclusive em rascunho',
  })
  findDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.execute(id, user);
  }
}
