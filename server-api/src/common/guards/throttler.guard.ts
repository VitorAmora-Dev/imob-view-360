import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Mantém todo o comportamento do ThrottlerGuard — inclusive o header
 * `Retry-After`, que ele já emite ao bloquear — e troca apenas o corpo do 429
 * pelo contrato de erro combinado com o frontend.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // timeToBlockExpire vem em segundos; arredonda para cima e nunca devolve 0,
    // que o cliente leria como "pode tentar de novo agora".
    const retryAfter = Math.max(
      1,
      Math.ceil(throttlerLimitDetail.timeToBlockExpire),
    );

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Muitas requisições. Tente novamente em instantes.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
