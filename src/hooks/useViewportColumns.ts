import { useMemo } from 'react';

import { CalculatedColumn, Column } from '../types';
import { DataGridProps } from '../DataGrid';
import { ValueFormatter, ToggleGroupFormatter } from '../formatters';
import { SELECT_COLUMN_KEY } from '../Columns';

interface ViewportColumnsArgs<R, SR> extends Pick<DataGridProps<R, SR>, 'defaultColumnOptions'> {
  rawColumns: readonly Column<R, SR>[];
  rawGroupBy?: readonly string[];
  viewportWidth: number;
  scrollLeft: number;
  columnWidths: ReadonlyMap<string, number>;
}

export function useViewportColumns<R, SR>({
  rawColumns,
  columnWidths,
  viewportWidth,
  scrollLeft,
  defaultColumnOptions,
  rawGroupBy
}: ViewportColumnsArgs<R, SR>) {
  const minColumnWidth = defaultColumnOptions?.minWidth ?? 80;
  const defaultFormatter = defaultColumnOptions?.formatter ?? ValueFormatter;
  const defaultSortable = defaultColumnOptions?.sortable ?? false;
  const defaultResizable = defaultColumnOptions?.resizable ?? false;

  const { columns, lastFrozenColumnIndex, groupBy } = useMemo(() => {
    let lastFrozenColumnIndex = -1;
    // type IntermediateColumn = Column<R, SR> & { width: number | undefined; rowGroup?: boolean };
    type IntermediateColumn = Column<R, SR> & { rowGroup?: boolean };
    // const totalFrozenColumnWidth = 0;

    const columns = rawColumns.map(metricsColumn => {
      const column: IntermediateColumn = { ...metricsColumn };

      if (rawGroupBy?.includes(column.key)) {
        column.frozen = true;
        column.rowGroup = true;
      }

      if (column.frozen) {
        lastFrozenColumnIndex++;
      }

      return column;
    });

    columns.sort(({ key: aKey, frozen: frozenA }, { key: bKey, frozen: frozenB }) => {
      // Sort select column first:
      if (aKey === SELECT_COLUMN_KEY) return -1;
      if (bKey === SELECT_COLUMN_KEY) return 1;

      // Sort grouped columns second, following the groupBy order:
      if (rawGroupBy?.includes(aKey)) {
        if (rawGroupBy.includes(bKey)) {
          return rawGroupBy.indexOf(aKey) - rawGroupBy.indexOf(bKey);
        }
        return -1;
      }
      if (rawGroupBy?.includes(bKey)) return 1;

      // Sort frozen columns third:
      if (frozenA) {
        if (frozenB) return 0;
        return -1;
      }
      if (frozenB) return 1;

      // Sort other columns last:
      return 0;
    });

    // Filter rawGroupBy and ignore keys that do not match the columns prop
    const groupBy: string[] = [];
    const calculatedColumns: CalculatedColumn<R, SR>[] = columns.map((column, idx) => {
      // Every column should have a valid width as this stage
      const newColumn = {
        ...column,
        idx,
        // width,
        // left,
        sortable: column.sortable ?? defaultSortable,
        resizable: column.resizable ?? defaultResizable,
        formatter: column.formatter ?? defaultFormatter
      };

      if (newColumn.rowGroup) {
        groupBy.push(column.key);
        newColumn.groupFormatter = column.groupFormatter ?? ToggleGroupFormatter;
      }

      return newColumn;
    });

    if (lastFrozenColumnIndex !== -1) {
      const lastFrozenColumn = calculatedColumns[lastFrozenColumnIndex];
      lastFrozenColumn.isLastFrozenColumn = true;
      // totalFrozenColumnWidth = lastFrozenColumn.left + lastFrozenColumn.width;
    }

    return {
      columns: calculatedColumns,
      lastFrozenColumnIndex,
      // totalFrozenColumnWidth,
      // totalColumnWidth: totalWidth,
      groupBy
    };
  }, [rawColumns, rawGroupBy, defaultFormatter, defaultResizable, defaultSortable]);

  const { cssColumnVars, totalColumnWidth, columnWidthMap, columnLeftMap } = useMemo(() => {
    const columnWidthMap = new Map<Column<R, SR>, number>();
    const columnLeftMap = new Map<Column<R, SR>, number>();
    const cssColumnVars: Record<string, string> = Object.create(null);
    let left = 0;
    let totalColumnWidth = 0;
    let allocatedWidths = 0;
    let unassignedColumnsCount = 0;

    for (const column of columns) {
      let width = getSpecifiedWidth(column, columnWidths, viewportWidth);

      if (width === undefined) {
        unassignedColumnsCount++;
      } else {
        width = clampColumnWidth(width, column, minColumnWidth);
        allocatedWidths += width;
        columnWidthMap.set(column, width);
      }
    }

    const unallocatedWidth = viewportWidth - allocatedWidths;
    const unallocatedColumnWidth = Math.max(
      Math.floor(unallocatedWidth / unassignedColumnsCount),
      minColumnWidth
    );

    for (const column of columns) {
      const width = columnWidthMap.get(column) ?? clampColumnWidth(unallocatedColumnWidth, column, minColumnWidth);
      const { key } = column;
      cssColumnVars[`--column-width-${key}`] = `${width}px`;
      cssColumnVars[`--column-left-${key}`] = `${left}px`;
      columnLeftMap.set(column, left);
      totalColumnWidth += width;
      left += width;
    }

    return { cssColumnVars, totalColumnWidth, columnLeftMap, columnWidthMap };
  }, [columnWidths, columns, viewportWidth, minColumnWidth]);

  let totalFrozenColumnWidth = 0;
  if (lastFrozenColumnIndex !== -1) {
    const lastFrozenColumn = columns[lastFrozenColumnIndex];
    // lastFrozenColumn.isLastFrozenColumn = true;
    totalFrozenColumnWidth = columnLeftMap.get(lastFrozenColumn)! + columnWidthMap.get(lastFrozenColumn)!;
  }

  const [colOverscanStartIdx, colOverscanEndIdx] = useMemo((): [number, number] => {
    // get the viewport's left side and right side positions for non-frozen columns
    const viewportLeft = scrollLeft + totalFrozenColumnWidth;
    const viewportRight = scrollLeft + viewportWidth;
    // get first and last non-frozen column indexes
    const lastColIdx = columns.length - 1;
    const firstUnfrozenColumnIdx = Math.min(lastFrozenColumnIndex + 1, lastColIdx);

    // skip rendering non-frozen columns if the frozen columns cover the entire viewport
    if (viewportLeft >= viewportRight) {
      return [firstUnfrozenColumnIdx, firstUnfrozenColumnIdx];
    }

    // get the first visible non-frozen column index
    let colVisibleStartIdx = firstUnfrozenColumnIdx;
    while (colVisibleStartIdx < lastColIdx) {
      const col = columns[colVisibleStartIdx];
      const left = columnLeftMap.get(col)!;
      const width = columnWidthMap.get(col)!;
      // if the right side of the columnn is beyond the left side of the available viewport,
      // then it is the first column that's at least partially visible
      if (left + width > viewportLeft) {
        break;
      }
      colVisibleStartIdx++;
    }

    // get the last visible non-frozen column index
    let colVisibleEndIdx = colVisibleStartIdx;
    while (colVisibleEndIdx < lastColIdx) {
      const col = columns[colVisibleEndIdx];
      const left = columnLeftMap.get(col)!;
      const width = columnWidthMap.get(col)!;
      // if the right side of the column is beyond or equal to the right side of the available viewport,
      // then it the last column that's at least partially visible, as the previous column's right side is not beyond the viewport.
      if (left + width >= viewportRight) {
        break;
      }
      colVisibleEndIdx++;
    }

    const colOverscanStartIdx = Math.max(firstUnfrozenColumnIdx, colVisibleStartIdx - 1);
    const colOverscanEndIdx = Math.min(lastColIdx, colVisibleEndIdx + 1);

    return [colOverscanStartIdx, colOverscanEndIdx];
  }, [columnLeftMap, columnWidthMap, columns, lastFrozenColumnIndex, scrollLeft, totalFrozenColumnWidth, viewportWidth]);

  const viewportColumns = useMemo((): readonly CalculatedColumn<R, SR>[] => {
    const viewportColumns: CalculatedColumn<R, SR>[] = [];
    for (let colIdx = 0; colIdx <= colOverscanEndIdx; colIdx++) {
      const column = columns[colIdx];

      if (colIdx < colOverscanStartIdx && !column.frozen) continue;
      viewportColumns.push(column);
    }

    return viewportColumns;
  }, [colOverscanEndIdx, colOverscanStartIdx, columns]);

  return { columns, viewportColumns, totalColumnWidth, lastFrozenColumnIndex, totalFrozenColumnWidth, groupBy, cssColumnVars };
}

function getSpecifiedWidth<R, SR>(
  { key, width }: Column<R, SR>,
  columnWidths: ReadonlyMap<string, number>,
  viewportWidth: number
): number | undefined {
  if (columnWidths.has(key)) {
    // Use the resized width if available
    return columnWidths.get(key);
  }
  if (typeof width === 'number') {
    return width;
  }
  if (typeof width === 'string' && /^\d+%$/.test(width)) {
    return Math.floor(viewportWidth * parseInt(width, 10) / 100);
  }
  return undefined;
}

function clampColumnWidth<R, SR>(
  width: number,
  { minWidth, maxWidth }: Column<R, SR>,
  minColumnWidth: number
): number {
  width = Math.max(width, minWidth ?? minColumnWidth);

  if (typeof maxWidth === 'number') {
    return Math.min(width, maxWidth);
  }

  return width;
}
