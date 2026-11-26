import { Table } from "@mantine/core";
import type { ReactNode } from "react";

/** The muted column heads every box score table shares (game-rooms Box frames). */
export const STAT_HEAD = {
	color: "var(--bt-muted)",
	fontSize: 11,
	fontWeight: 400,
} as const;

/** One stat column: its head (`AB`, `ERA`), its cell for a row, and its width. */
export type StatColumn<Row> = {
	label: string;
	cell: (row: Row) => ReactNode;
	width?: number;
};

/**
 * A box score stat table (S207): a `PLAYER` column, then one centered column per stat, the last
 * one right-aligned, in the Box room's type sizes and hairline rows. The batting and the pitching
 * tables are both drawn through it, so the two read as one family (S207 AC 4). It formats nothing
 * itself: each column's `cell` gives what to show, MLB's own numbers and strings.
 */
export function StatTable<Row>({
	label, rows, rowKey, player, columns, testId,
}: {
	/** The table's accessible name (`CHC batting`). */
	label: string;
	rows: readonly Row[];
	rowKey: (row: Row) => number | string;
	/** The `PLAYER` cell for a row. */
	player: (row: Row) => ReactNode;
	columns: readonly StatColumn<Row>[];
	/** Each row's `data-testid` (`batting-row`). */
	testId: string;
})
{
	const last = columns.length - 1;
	return (
		<Table aria-label={label} verticalSpacing={12} horizontalSpacing={0} withRowBorders>
			<Table.Thead>
				<Table.Tr>
					<Table.Th style={STAT_HEAD}>PLAYER</Table.Th>
					{columns.map((column, i) => (
						<Table.Th key={column.label} ta={i === last ? "right" : "center"} w={column.width ?? 30} style={STAT_HEAD}>{column.label}</Table.Th>
					))}
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{rows.map((row) => (
					<Table.Tr key={rowKey(row)} data-testid={testId}>
						<Table.Td fz={12}>{player(row)}</Table.Td>
						{columns.map((column, i) => <Table.Td key={column.label} ta={i === last ? "right" : "center"} fz={12}>{column.cell(row)}</Table.Td>)}
					</Table.Tr>
				))}
			</Table.Tbody>
		</Table>
	);
}
