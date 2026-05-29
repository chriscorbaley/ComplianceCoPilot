// Audit-review table for Real Estate activity. Visual style mirrors the
// utility tracking table: clean rows, alternating #F2F4F6 / white data rows,
// 0.5px #CCCCCC borders, dark #1A1A2E text, a navy header row, light-blue
// property group headers with subtotals, and a navy grand-total row.

import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import {
  formatActivityDate,
  type GroupedActivityLog,
} from '../services/activityLog';

const TABLE_BORDER = '#CCCCCC';
const ROW_ALT = '#F2F4F6';
const GROUP_HEADER_BG = '#E6F1FB';
const GROUP_HEADER_FG = '#185FA5';
const TEXT_DARK = '#1A1A2E';

const ACTIVITY_TRUNCATE = 40;

const truncate = (text: string): string =>
  text.length > ACTIVITY_TRUNCATE ? `${text.slice(0, ACTIVITY_TRUNCATE)}...` : text;

interface ActivityLogTableProps {
  grouped: GroupedActivityLog;
}

export const ActivityLogTable: React.FC<ActivityLogTableProps> = ({ grouped }) => {
  // A running counter across all data rows drives the zebra striping so it
  // stays consistent even across property group boundaries.
  let dataRowIndex = -1;

  return (
    <View style={styles.table}>
      {/* Column header */}
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cell, styles.colProperty, styles.headerText]}>Property</Text>
        <Text style={[styles.cell, styles.colDate, styles.headerText]}>Date</Text>
        <Text style={[styles.cell, styles.colActivity, styles.headerText]}>Activity</Text>
        <Text style={[styles.cell, styles.colHours, styles.headerText, styles.hoursAlign]}>
          Hours
        </Text>
      </View>

      {grouped.groups.length === 0 ? (
        <View style={[styles.row, styles.emptyRow]}>
          <Text style={styles.emptyText}>No activities logged in this date range.</Text>
        </View>
      ) : (
        grouped.groups.map((group) => (
          <View key={group.key}>
            {/* Property group header spanning the full width */}
            <View style={[styles.row, styles.groupHeaderRow]}>
              <Text style={styles.groupHeaderName} numberOfLines={1}>
                {group.propertyName}
              </Text>
              <Text style={styles.groupHeaderTotal}>
                Total: {group.subtotalHours.toFixed(1)} hrs
              </Text>
            </View>

            {group.entries.map((entry) => {
              dataRowIndex += 1;
              const striped = dataRowIndex % 2 === 1;
              return (
                <TouchableOpacity
                  key={entry.id}
                  activeOpacity={0.6}
                  onPress={() =>
                    Alert.alert(
                      `${group.propertyName} · ${formatActivityDate(entry.activityDate)}`,
                      entry.description || 'No description recorded.',
                    )
                  }
                  style={[styles.row, styles.dataRow, striped && styles.dataRowStriped]}
                >
                  <Text style={[styles.cell, styles.colProperty, styles.dataText]} numberOfLines={1}>
                    {group.propertyName}
                  </Text>
                  <Text style={[styles.cell, styles.colDate, styles.dataText]} numberOfLines={1}>
                    {formatActivityDate(entry.activityDate)}
                  </Text>
                  <Text style={[styles.cell, styles.colActivity, styles.dataText]} numberOfLines={1}>
                    {truncate(entry.description || '—')}
                  </Text>
                  <Text
                    style={[styles.cell, styles.colHours, styles.dataText, styles.hoursAlign]}
                  >
                    {entry.hours.toFixed(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}

      {/* Grand total */}
      <View style={[styles.row, styles.grandTotalRow]}>
        <Text style={styles.grandTotalLabel}>Total Hours All Properties</Text>
        <Text style={styles.grandTotalValue}>{grouped.grandTotalHours.toFixed(1)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  table: {
    borderWidth: 0.5,
    borderColor: TABLE_BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 12,
  },
  colProperty: { flex: 2.2 },
  colDate: { flex: 1.6 },
  colActivity: { flex: 2.6 },
  colHours: { flex: 1 },
  hoursAlign: { textAlign: 'right' },

  headerRow: {
    backgroundColor: colors.navy,
  },
  headerText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.2,
  },

  groupHeaderRow: {
    backgroundColor: GROUP_HEADER_BG,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: TABLE_BORDER,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  groupHeaderName: {
    flex: 1,
    color: GROUP_HEADER_FG,
    fontWeight: '700',
    fontSize: 13,
  },
  groupHeaderTotal: {
    color: GROUP_HEADER_FG,
    fontWeight: '700',
    fontSize: 13,
  },

  dataRow: {
    backgroundColor: colors.white,
    borderTopWidth: 0.5,
    borderColor: TABLE_BORDER,
  },
  dataRowStriped: {
    backgroundColor: ROW_ALT,
  },
  dataText: {
    color: TEXT_DARK,
  },

  emptyRow: {
    borderTopWidth: 0.5,
    borderColor: TABLE_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  emptyText: {
    color: colors.mutedText,
    fontSize: 13,
    fontStyle: 'italic',
  },

  grandTotalRow: {
    backgroundColor: colors.navy,
    borderTopWidth: 0.5,
    borderColor: TABLE_BORDER,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  grandTotalLabel: {
    flex: 1,
    color: colors.white,
    fontWeight: '700',
    fontSize: 12,
  },
  grandTotalValue: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
    paddingRight: 8,
  },
});
