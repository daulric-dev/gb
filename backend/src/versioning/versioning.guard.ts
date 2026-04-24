import {
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { VersioningService } from './versioning.service';

@Injectable()
export class VersioningGuard implements CanActivate {
  constructor(private readonly versioning: VersioningService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.['x-api-version'];

    if (!header) return true;

    const v = Number(header);

    if (!v || !Number.isInteger(v) || v < 1) {
      throw new BadRequestException(
        `Invalid API version "${header}". Must be a positive integer.`,
      );
    }

    const allVersions = this.versioning
      .getRegisteredNamespaces()
      .flatMap((ns) => this.versioning.getVersions(ns));

    if (allVersions.length === 0) return true;

    const maxVersion = Math.max(...allVersions);

    if (v > maxVersion) {
      throw new BadRequestException(
        `API version ${v} does not exist. Latest version is ${maxVersion}.`,
      );
    }

    return true;
  }
}
