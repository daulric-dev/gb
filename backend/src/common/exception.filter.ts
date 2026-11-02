import { randomBytes } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  IntrinsicException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** What a client is told when the server fails for a reason it did not intend. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** A short id to quote in a support request and find in the logs. */
export function newErrorId(): string {
  return randomBytes(4).toString('hex');
}

@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private static readonly log = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    if (this.isHttpError(exception) && (exception as { statusCode: number }).statusCode < 500) {
      super.catch(exception, host);
      return;
    }

    const adapter = this.applicationRef ?? this.httpAdapterHost?.httpAdapter;
    const [req, res] = [host.getArgByIndex(0), host.getArgByIndex(1)];
    const errorId = newErrorId();

    if (!(exception instanceof IntrinsicException)) {
      const method = (req && adapter?.getRequestMethod?.(req)) ?? '?';
      const url = (req && adapter?.getRequestUrl?.(req)) ?? '?';
      AppExceptionFilter.log.error(
        `[${errorId}] ${method} ${url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (!adapter || !res) return;
    if (adapter.isHeadersSent(res)) {
      adapter.end(res);
      return;
    }
    adapter.reply(
      res,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_ERROR_MESSAGE,
        errorId,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
