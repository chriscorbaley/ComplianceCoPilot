import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { DateInputField } from '../../components/DateInputField';
import {
  fetchAuditFilterOptions,
  fetchAuditLog,
  type AuditLogEntry,
  type AuditLogFilters,
} from '../../services/auditLog';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminLoading,
  listStyles,
} from './_shared';

// Turn an action slug ('update_pricing') into a readable label ('Update pricing').
const formatAction = (action: string): string => {
  const spaced = action.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// Compact one-line rendering of an old/new value for the collapsed summary.
const formatValueInline = (v: unknown): string => {
  if (v == null) return '∅';
  if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 48)}…` : v;
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 64 ? `${s.slice(0, 64)}…` : s;
    } catch {
      return String(v);
    }
  }
  return String(v);
};

// Full pretty rendering for the expanded view.
const formatValueFull = (v: unknown): string => {
  if (v == null) return '(none)';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const startOfDayISO = (d: Date): string =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
const endOfDayISO = (d: Date): string =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();

interface FilterState {
  adminEmail: string | null;
  tableAffected: string | null;
  from: Date | null;
  to: Date | null;
}

const EMPTY_FILTERS: FilterState = {
  adminEmail: null,
  tableAffected: null,
  from: null,
  to: null,
};

export const AuditLogViewer: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [options, setOptions] = useState<{ admins: string[]; tables: string[] }>({
    admins: [],
    tables: [],
  });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // The audit table may not expose a surrogate id, so derive a stable key from
  // the row's own fields plus its position in the (append-only, ordered) list.
  const keyFor = (entry: AuditLogEntry, index: number): string =>
    entry.id ?? `${entry.created_at}#${entry.action}#${index}`;

  const toQueryFilters = useCallback((f: FilterState): AuditLogFilters => ({
    adminEmail: f.adminEmail,
    tableAffected: f.tableAffected,
    from: f.from ? startOfDayISO(f.from) : null,
    to: f.to ? endOfDayISO(f.to) : null,
  }), []);

  // (Re)load the first page for the current filters.
  const loadFirstPage = useCallback(async (f: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchAuditLog(toQueryFilters(f), 0);
      setEntries(page.entries);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [toQueryFilters]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuditLog(toQueryFilters(filters), entries.length);
      setEntries((cur) => [...cur, ...page.entries]);
      setHasMore(page.hasMore);
    } catch {
      // Keep what we have; a failed "load more" shouldn't blank the list.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [entries.length, filters, loadingMore, toQueryFilters]);

  // Refresh filter dropdown options once on mount.
  useEffect(() => {
    fetchAuditFilterOptions()
      .then(setOptions)
      .catch(() => setOptions({ admins: [], tables: [] }));
  }, []);

  // Reload whenever the filters change.
  useEffect(() => {
    loadFirstPage(filters);
  }, [filters, loadFirstPage]);

  const anyFilterActive =
    filters.adminEmail != null ||
    filters.tableAffected != null ||
    filters.from != null ||
    filters.to != null;

  const renderFilters = () => (
    <View style={styles.filterBlock}>
      <View style={styles.filterHeaderRow}>
        <Text style={styles.filterHeader}>Filters</Text>
        {anyFilterActive && (
          <TouchableOpacity onPress={() => setFilters(EMPTY_FILTERS)} hitSlop={8}>
            <Text style={styles.clearText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      {options.admins.length > 0 && (
        <>
          <Text style={styles.filterLabel}>Admin</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {options.admins.map((email) => {
              const active = filters.adminEmail === email;
              return (
                <TouchableOpacity
                  key={email}
                  onPress={() =>
                    setFilters((f) => ({ ...f, adminEmail: active ? null : email }))
                  }
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {email}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {options.tables.length > 0 && (
        <>
          <Text style={styles.filterLabel}>Table</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {options.tables.map((table) => {
              const active = filters.tableAffected === table;
              return (
                <TouchableOpacity
                  key={table}
                  onPress={() =>
                    setFilters((f) => ({ ...f, tableAffected: active ? null : table }))
                  }
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {table}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      <Text style={styles.filterLabel}>Date range</Text>
      <View style={styles.dateRow}>
        <View style={styles.dateCol}>
          <DateInputField
            label="From"
            value={filters.from}
            onChange={(d) => setFilters((f) => ({ ...f, from: d }))}
            placeholder="MM/DD/YYYY"
          />
        </View>
        <View style={styles.dateCol}>
          <DateInputField
            label="To"
            value={filters.to}
            onChange={(d) => setFilters((f) => ({ ...f, to: d }))}
            placeholder="MM/DD/YYYY"
          />
        </View>
      </View>
      {(filters.from || filters.to) && (
        <TouchableOpacity
          onPress={() => setFilters((f) => ({ ...f, from: null, to: null }))}
          hitSlop={8}
          style={styles.clearDatesBtn}
        >
          <Ionicons name="close-circle-outline" size={13} color={colors.midNavy} />
          <Text style={styles.clearText}>Clear dates</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderEntry = (entry: AuditLogEntry, index: number) => {
    const key = keyFor(entry, index);
    const isOpen = expandedKey === key;
    return (
      <AdminCard key={key} style={styles.entryCard}>
        <TouchableOpacity
          onPress={() => setExpandedKey(isOpen ? null : key)}
          activeOpacity={0.85}
        >
          <View style={styles.entryTopRow}>
            <Text style={styles.actionText}>{formatAction(entry.action)}</Text>
            <Ionicons
              name={isOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.mutedText}
            />
          </View>
          <Text style={styles.metaText}>
            {new Date(entry.created_at).toLocaleString()}
            {'  ·  '}
            {entry.admin_email ?? 'unknown admin'}
          </Text>
          <View style={styles.tagRow}>
            {entry.table_affected ? (
              <View style={styles.tableTag}>
                <Text style={styles.tableTagText}>{entry.table_affected}</Text>
              </View>
            ) : null}
            {entry.record_key ? (
              <Text style={styles.recordKeyText} numberOfLines={1}>
                {entry.record_key}
              </Text>
            ) : null}
          </View>
          <Text style={styles.summaryText} numberOfLines={isOpen ? undefined : 1}>
            {formatValueInline(entry.old_value)} → {formatValueInline(entry.new_value)}
          </Text>
        </TouchableOpacity>

        {isOpen && (
          <View style={styles.expandBlock}>
            <Text style={styles.expandLabel}>Old value</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{formatValueFull(entry.old_value)}</Text>
            </View>
            <Text style={styles.expandLabel}>New value</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{formatValueFull(entry.new_value)}</Text>
            </View>
          </View>
        )}
      </AdminCard>
    );
  };

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <Text style={styles.intro}>
        Read-only record of every admin change. Entries cannot be edited or deleted here.
      </Text>

      {renderFilters()}

      {loading && <AdminLoading label="Loading audit log…" />}

      {!loading && error && (
        <AdminEmpty icon="alert-circle-outline" title="Could not load audit log" hint={error} />
      )}

      {!loading && !error && entries.length === 0 && (
        <AdminEmpty
          icon="receipt-outline"
          title="No audit entries"
          hint={
            anyFilterActive
              ? 'No entries match the current filters.'
              : 'Admin changes will appear here as they happen.'
          }
        />
      )}

      {!loading && !error && entries.map((entry, i) => renderEntry(entry, i))}

      {!loading && !error && hasMore && (
        <AdminButton
          label={loadingMore ? 'Loading…' : 'Load more'}
          icon="chevron-down-outline"
          variant="secondary"
          onPress={loadMore}
          loading={loadingMore}
          style={styles.loadMore}
        />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  intro: {
    ...typography.caption,
    color: colors.mutedText,
    paddingHorizontal: spacing.xs,
  },
  filterBlock: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterHeader: {
    ...typography.caption,
    color: colors.midNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    fontWeight: '700',
  },
  clearText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '600',
  },
  filterLabel: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  chipRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.lightBlue,
  },
  chipActive: { backgroundColor: colors.midNavy },
  chipText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: { color: colors.white },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dateCol: { flex: 1 },
  clearDatesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  entryCard: { gap: 4 },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionText: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 14,
    flex: 1,
  },
  metaText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 6,
  },
  tableTag: {
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  tableTagText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  recordKeyText: {
    ...typography.micro,
    color: colors.subtleText,
    fontSize: 10,
    flex: 1,
  },
  summaryText: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 12,
    marginTop: 6,
  },
  expandBlock: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
    gap: 4,
  },
  expandLabel: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  codeBox: {
    backgroundColor: colors.background,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    padding: spacing.sm,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: 11,
    lineHeight: 16,
    color: colors.bodyText,
  },
  loadMore: { marginTop: spacing.sm },
});
