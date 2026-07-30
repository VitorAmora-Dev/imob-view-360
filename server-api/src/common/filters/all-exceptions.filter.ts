import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Contrato de erro da API, combinado com o frontend:
 * `statusCode` e `message` sempre presentes. `details` carrega o erro por campo
 * das validações Zod, e chaves extras (como `retryAfter` do rate limiting) são
 * preservadas.
 */
interface ErrorBody {
  statusCode: number;
  message: string;
  details?: unknown;
  [extra: string]: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const body = this.toErrorBody(exception);

    // Só 5xx vira log com stack: 4xx é erro do cliente, não incidente do servidor.
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Erros que não são HttpException mas trazem status — o caso concreto é o
    // PayloadTooLargeError do body-parser.
    const status = this.statusFrom(exception);
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return {
        statusCode: status,
        message: 'Corpo da requisição excede o limite permitido',
      };
    }
    if (status !== undefined && status < HttpStatus.INTERNAL_SERVER_ERROR) {
      return { statusCode: status, message: 'Requisição inválida' };
    }

    // Qualquer outra coisa é falha nossa: nada do original vaza para o cliente.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno do servidor',
    };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload !== 'object' || payload === null) {
      return { statusCode, message: String(payload) };
    }

    const record = payload as Record<string, unknown>;

    // Saída de ZodValidationPipe (schema.flatten()): mantém o detalhe por campo.
    if ('fieldErrors' in record || 'formErrors' in record) {
      return { statusCode, message: 'Dados inválidos', details: record };
    }

    // `error` e `statusCode` do formato padrão do Nest são descartados; o resto
    // segue adiante para não perder campos como `retryAfter`.
    const extra = { ...record };
    delete extra.message;
    delete extra.error;
    delete extra.statusCode;

    return {
      statusCode,
      message: this.asMessage(record.message) ?? exception.message,
      ...extra,
    };
  }

  private asMessage(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const joined = value.filter((v) => typeof v === 'string').join('; ');
      return joined || undefined;
    }
    return undefined;
  }

  private statusFrom(exception: unknown): number | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;
    const candidate = exception as { status?: unknown; statusCode?: unknown };
    const raw = candidate.status ?? candidate.statusCode;
    return typeof raw === 'number' && raw >= 400 && raw <= 599
      ? raw
      : undefined;
  }
}
