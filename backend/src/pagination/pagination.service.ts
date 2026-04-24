import { Injectable } from '@nestjs/common';
import { PaginationQueryDto, PaginatedResult } from './pagination.dto';

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class PaginationService {
  async paginate<T extends Record<string, any>>(
    queryBuilder: any,
    dto: PaginationQueryDto,
  ): Promise<PaginatedResult<T>> {
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;
    const isCursorMode = dto.cursor !== undefined;

    if (isCursorMode) {
      return this.cursorPaginate<T>(queryBuilder, dto, pageSize);
    }
    return this.offsetPaginate<T>(queryBuilder, dto, pageSize);
  }

  private async offsetPaginate<T>(
    queryBuilder: any,
    dto: PaginationQueryDto,
    pageSize: number,
  ): Promise<PaginatedResult<T>> {
    
    const page = dto.page ?? 1;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await queryBuilder
      .range(from, to)
      .select('*', { count: 'exact', head: false });

    if (error) throw error;

    const total = count ?? 0;
    const pageCount = Math.ceil(total / pageSize);

    return {
      data: (data as T[]) ?? [],
      meta: {
        total,
        page,
        pageSize,
        pageCount,
        nextCursor: null,
        hasMore: page < pageCount,
      },
    };
  }

  private async cursorPaginate<T>(
    queryBuilder: any,
    dto: PaginationQueryDto,
    pageSize: number,
  ): Promise<PaginatedResult<T>> {
    const column = dto.cursorColumn ?? 'id';
    const direction = dto.cursorDirection ?? 'asc';
    const ascending = direction === 'asc';

    let query = queryBuilder;

    if (dto.cursor) {
      query = ascending
        ? query.gt(column, dto.cursor)
        : query.lt(column, dto.cursor);
    }

    const { data, error, count } = await query
      .order(column, { ascending })
      .limit(pageSize + 1)
      .select('*', { count: 'exact', head: false });

    if (error) throw error;

    const rows = (data as T[]) ?? [];
    const hasMore = rows.length > pageSize;
    const pageData = hasMore ? rows.slice(0, pageSize) : rows;

    const lastItem = pageData[pageData.length - 1];
    const nextCursor = hasMore && lastItem ? String(lastItem[column]) : null;

    return {
      data: pageData,
      meta: {
        total: count ?? 0,
        page: null,
        pageSize,
        pageCount: null,
        nextCursor,
        hasMore,
      },
    };
  }
}
