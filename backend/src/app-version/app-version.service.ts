import { Injectable, Logger } from '@nestjs/common';
import {
  compareVersions,
  loadAppVersionConfig,
  MOBILE_PLATFORMS,
  parseClientVersion,
  type AppVersionConfig,
} from './app-version.config';

/** Why a build is refused: the store to send it to (null when unknown). */
export interface UpdateRequired {
  storeUrl: string | null;
}

@Injectable()
export class AppVersionService {
  private readonly logger = new Logger(AppVersionService.name);
  /** Read once at boot; a bad value in production fails the boot here. */
  private readonly config: AppVersionConfig;

  constructor() {
    this.config = loadAppVersionConfig(process.env, (m) => this.logger.warn(m));
  }

  /** What GET /api/app/version answers. */
  versions(): AppVersionConfig {
    return this.config;
  }

  /**
   * Whether the build named by an X-GradeBook-App-Version header is below its
   * platform's minimum. No header, or one we can't read, is never refused. A
   * bare version (no platform) is held to the lower of the two minimums.
   */
  updateRequired(header: unknown): UpdateRequired | null {
    const client = parseClientVersion(header);
    if (!client) return null;

    if (client.platform) {
      const { minimum, storeUrl } = this.config[client.platform];
      return minimum && compareVersions(client.version, minimum) < 0
        ? { storeUrl }
        : null;
    }

    const minimums = MOBILE_PLATFORMS.map((p) => this.config[p].minimum).filter(
      (v): v is string => v !== null,
    );
    if (minimums.length < MOBILE_PLATFORMS.length) return null;
    const lowest = minimums.reduce((a, b) => (compareVersions(a, b) <= 0 ? a : b));
    return compareVersions(client.version, lowest) < 0 ? { storeUrl: null } : null;
  }
}
