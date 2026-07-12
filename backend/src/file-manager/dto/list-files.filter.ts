/**
 * Which files a listing returns. Kept in its own module (no decorators) so the
 * domain service and its tests can use it without loading the request DTO's
 * class-validator decorators - those only need to run inside the HTTP layer.
 */
export enum FileListFilter {
  /** Files the caller owns. */
  Own = 'own',
  /** Files shared with the caller (directly, by role, or by group). */
  Shared = 'shared',
  /** Both of the above. */
  All = 'all',
}
