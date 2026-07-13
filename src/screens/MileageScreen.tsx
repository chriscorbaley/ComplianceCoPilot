import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { Header } from '../components/Header';
import { YearSelector } from '../components/YearSelector';
import { DateInputField, DatePickerModal } from '../components/DateInputField';
import { MileageLockedScreen } from '../components/MileageLockedScreen';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { useYear } from '../context/YearContext';
import { useBusiness } from '../business/BusinessContext';
import { useAuth } from '../auth/AuthContext';
import {
  supabase,
  requireUserId,
  type MileageLogRow,
  type MileageTripType,
  type VehicleRow,
} from '../services/supabase';
import {
  ComplianceRules,
  loadComplianceRules,
  subscribeToRules,
} from '../services/complianceRules';
import {
  generateMileageReport,
  mileageRate,
  vehicleLabel,
  vehicleYmm,
} from '../services/mileage';

type SubTab = 'log' | 'history' | 'vehicles';

const SUB_TABS: Array<{ key: SubTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'log', label: 'Log Miles', icon: 'speedometer-outline' },
  { key: 'history', label: 'Trip History', icon: 'time-outline' },
  { key: 'vehicles', label: 'Vehicles', icon: 'car-outline' },
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MIN_TRIP_DATE = new Date('2020-01-01');

const parseISODate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toISODate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const formatMMMDD = (iso: string | null): string => {
  const d = parseISODate(iso);
  if (!d) return '—';
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
};

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseNum = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// ── Gate ─────────────────────────────────────────────────────────────────

// Mileage tracking is Pro-only. Basic and Core subscribers see the locked
// upgrade screen; admins (null tier) and Pro see the full tracker.
export const MileageScreen: React.FC = () => {
  const access = useStrategyAccess();
  if (!access.isPro) return <MileageLockedScreen />;
  return <MileageScreenInner />;
};

const MileageScreenInner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { year } = useYear();
  const { activeBusinessId } = useBusiness();
  const [tab, setTab] = useState<SubTab>('log');
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [trips, setTrips] = useState<MileageLogRow[]>([]);
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | 'new' | null>(null);
  const [editingTrip, setEditingTrip] = useState<MileageLogRow | null>(null);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  const loadVehicles = useCallback(async () => {
    try {
      let q = supabase.from('vehicles').select('*').order('created_at', { ascending: true });
      if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
      const { data, error } = await q;
      if (error) throw error;
      setVehicles((data ?? []) as VehicleRow[]);
    } catch (e) {
      Alert.alert('Could not load vehicles', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId]);

  const loadTrips = useCallback(async () => {
    try {
      let q = supabase
        .from('mileage_log')
        .select('*')
        .eq('tax_year', year)
        .order('trip_date', { ascending: false, nullsFirst: false });
      if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
      const { data, error } = await q;
      if (error) throw error;
      setTrips((data ?? []) as MileageLogRow[]);
    } catch (e) {
      Alert.alert('Could not load trips', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, year]);

  useFocusEffect(
    useCallback(() => {
      loadVehicles();
      loadTrips();
    }, [loadVehicles, loadTrips]),
  );

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.is_active), [vehicles]);

  return (
    <View style={styles.root}>
      <Header subtitle="Mileage Tracker" year={year} />
      <YearSelector />

      <View style={styles.tabBar}>
        {SUB_TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.85}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
            >
              <Ionicons
                name={t.icon}
                size={15}
                color={active ? colors.white : colors.mutedText}
              />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {tab === 'log' && (
          <LogMilesTab
            year={year}
            rules={rules}
            vehicles={activeVehicles}
            insets={insets}
            onGoToVehicles={() => setTab('vehicles')}
            onSaved={async () => {
              await loadTrips();
              setTab('history');
            }}
          />
        )}
        {tab === 'history' && (
          <TripHistoryTab
            year={year}
            rules={rules}
            trips={trips}
            vehicles={vehicles}
            insets={insets}
            businessId={activeBusinessId}
            onEdit={setEditingTrip}
          />
        )}
        {tab === 'vehicles' && (
          <VehiclesTab
            vehicles={vehicles}
            insets={insets}
            onAdd={() => setEditingVehicle('new')}
            onEdit={setEditingVehicle}
            onToggleActive={loadVehicles}
          />
        )}
      </View>

      <VehicleEditSheet
        target={editingVehicle}
        businessId={activeBusinessId}
        onClose={() => setEditingVehicle(null)}
        onSaved={loadVehicles}
      />
      <TripEditSheet
        trip={editingTrip}
        rules={rules}
        vehicles={activeVehicles}
        onClose={() => setEditingTrip(null)}
        onSaved={loadTrips}
      />
    </View>
  );
};

// ── Shared: vehicle picker dropdown ────────────────────────────────────────

const VehiclePicker: React.FC<{
  vehicles: VehicleRow[];
  value: string | null;
  onChange: (id: string) => void;
}> = ({ vehicles, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = vehicles.find((v) => v.id === value) ?? null;
  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen(true)}
        style={styles.dropdown}
      >
        <Ionicons name="car-outline" size={16} color={colors.navy} />
        <Text style={styles.dropdownText} numberOfLines={1}>
          {selected ? vehicleLabel(selected) : 'Select a vehicle'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.mutedText} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Select vehicle</Text>
            {vehicles.map((v) => {
              const active = v.id === value;
              return (
                <TouchableOpacity
                  key={v.id}
                  activeOpacity={0.8}
                  onPress={() => {
                    onChange(v.id);
                    setOpen(false);
                  }}
                  style={[styles.optionRow, active && styles.optionRowActive]}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {vehicleLabel(v)}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={18} color={colors.teal} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const TripTypeToggle: React.FC<{
  value: MileageTripType;
  onChange: (t: MileageTripType) => void;
}> = ({ value, onChange }) => (
  <View style={styles.segmentRow}>
    {(['business', 'medical'] as const).map((kind) => {
      const active = value === kind;
      const activeStyle = kind === 'business' ? styles.segBusiness : styles.segMedical;
      return (
        <TouchableOpacity
          key={kind}
          activeOpacity={0.85}
          onPress={() => onChange(kind)}
          style={[styles.segmentBtn, active && activeStyle]}
        >
          <Ionicons
            name={kind === 'business' ? 'briefcase-outline' : 'medkit-outline'}
            size={14}
            color={active ? colors.white : colors.navy}
          />
          <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
            {kind === 'business' ? 'Business' : 'Medical'}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ── Log Miles tab ───────────────────────────────────────────────────────────

const LogMilesTab: React.FC<{
  year: number;
  rules: ComplianceRules | null;
  vehicles: VehicleRow[];
  insets: { bottom: number };
  onGoToVehicles: () => void;
  onSaved: () => Promise<void> | void;
}> = ({ year, rules, vehicles, insets, onGoToVehicles, onSaved }) => {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [tripType, setTripType] = useState<MileageTripType>('business');
  const [tripDate, setTripDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startOdo, setStartOdo] = useState('');
  const [endOdo, setEndOdo] = useState('');
  const [override, setOverride] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);

  // Auto-select the only vehicle when exactly one exists.
  useEffect(() => {
    if (vehicles.length === 1) setVehicleId((prev) => prev ?? vehicles[0].id);
    if (vehicleId && !vehicles.some((v) => v.id === vehicleId)) setVehicleId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles]);

  const calculated = useMemo(() => {
    const s = parseNum(startOdo);
    const e = parseNum(endOdo);
    if (!startOdo || !endOdo || e < s) return null;
    return e - s;
  }, [startOdo, endOdo]);

  const totalMiles = useMemo(() => {
    if (override.trim() !== '') return parseNum(override);
    return calculated ?? 0;
  }, [override, calculated]);

  const rate = mileageRate(rules, year, tripType);
  const deduction = totalMiles * rate;

  const resetForm = () => {
    setTripType('business');
    setTripDate(new Date());
    setStartOdo('');
    setEndOdo('');
    setOverride('');
    setPurpose('');
    if (vehicles.length === 1) setVehicleId(vehicles[0].id);
    else setVehicleId(null);
  };

  const onSubmit = async () => {
    if (!vehicleId) {
      Alert.alert('Select a vehicle', 'Choose which vehicle this trip was in.');
      return;
    }
    if (totalMiles <= 0) {
      Alert.alert('Enter miles', 'Enter odometer readings or a total-miles value.');
      return;
    }
    setSaving(true);
    try {
      const userId = await requireUserId();
      const { error } = await supabase.from('mileage_log').insert({
        user_id: userId,
        vehicle_id: vehicleId,
        trip_date: toISODate(tripDate),
        start_odometer: override.trim() === '' ? parseNum(startOdo) || null : null,
        end_odometer: override.trim() === '' ? parseNum(endOdo) || null : null,
        total_miles: totalMiles,
        trip_type: tripType,
        purpose: purpose.trim() || null,
        tax_year: year,
        deduction_amount: deduction,
      });
      if (error) throw new Error(error.message);
      Alert.alert('Trip logged', `${totalMiles} ${tripType} miles saved.`);
      resetForm();
      await onSaved();
    } catch (e) {
      Alert.alert('Could not log trip', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flexFill}
      keyboardVerticalOffset={100}
    >
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Vehicle</Text>
        {vehicles.length === 0 ? (
          <View style={styles.emptyVehicle}>
            <Text style={styles.emptyVehicleText}>Add a vehicle first</Text>
            <TouchableOpacity style={styles.addVehicleBtn} onPress={onGoToVehicles}>
              <Ionicons name="add" size={16} color={colors.white} />
              <Text style={styles.addVehicleBtnText}>Add Vehicle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <VehiclePicker vehicles={vehicles} value={vehicleId} onChange={setVehicleId} />
        )}

        <Text style={[styles.fieldLabel, styles.gapTop]}>Trip type</Text>
        <TripTypeToggle value={tripType} onChange={setTripType} />

        <DateInputField
          label="Trip date"
          value={tripDate}
          onChange={setTripDate}
          minimumDate={MIN_TRIP_DATE}
          pickerVisible={showDatePicker}
          onPickerVisibleChange={setShowDatePicker}
          style={styles.gapTop}
        />
        <DatePickerModal
          visible={showDatePicker}
          title="Trip Date"
          value={tripDate}
          minimumDate={MIN_TRIP_DATE}
          onConfirm={(d) => {
            setTripDate(d);
            setShowDatePicker(false);
          }}
          onCancel={() => setShowDatePicker(false)}
        />

        <View style={styles.fieldRow}>
          <View style={styles.flexHalf}>
            <Text style={styles.fieldLabel}>Starting Odometer (miles)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 45230"
              placeholderTextColor={colors.subtleText}
              keyboardType="numeric"
              value={startOdo}
              onChangeText={setStartOdo}
            />
          </View>
          <View style={styles.fieldGap} />
          <View style={styles.flexHalf}>
            <Text style={styles.fieldLabel}>Ending Odometer (miles)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 45287"
              placeholderTextColor={colors.subtleText}
              keyboardType="numeric"
              value={endOdo}
              onChangeText={setEndOdo}
            />
          </View>
        </View>

        {calculated != null ? (
          <View style={styles.calcCard}>
            <Ionicons name="calculator-outline" size={16} color={colors.teal} />
            <Text style={styles.calcText}>Calculated: {calculated} miles</Text>
          </View>
        ) : null}

        <View style={styles.gapTop}>
          <Text style={styles.fieldLabel}>Or enter total miles directly</Text>
          <Text style={styles.subLabel}>
            Use this if you didn't record your starting odometer
          </Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 57"
            placeholderTextColor={colors.subtleText}
            keyboardType="numeric"
            value={override}
            onChangeText={setOverride}
          />
          {override.trim() !== '' ? (
            <View style={styles.amberNote}>
              <Ionicons name="information-circle" size={13} color={colors.amber} />
              <Text style={styles.amberNoteText}>
                Manual entry overrides odometer calculation
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.gapTop}>
          <Text style={styles.fieldLabel}>Business purpose</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="Describe the business or medical purpose of this trip"
            placeholderTextColor={colors.subtleText}
            multiline
            value={purpose}
            onChangeText={setPurpose}
          />
        </View>

        {totalMiles > 0 ? (
          <View style={styles.deductionCard}>
            <Text style={styles.deductionLabel}>Estimated deduction:</Text>
            <Text style={styles.deductionValue}>
              {money(deduction)} ({totalMiles} miles × ${rate.toFixed(2)}/mile IRS {year} rate)
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onSubmit}
          disabled={saving}
          style={[styles.primaryBtn, saving && styles.btnDim]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="save-outline" size={16} color={colors.white} />
              <Text style={styles.primaryBtnText}>Log Trip</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Trip History tab ─────────────────────────────────────────────────────────

type HistoryFilter = 'all' | MileageTripType;

const TripHistoryTab: React.FC<{
  year: number;
  rules: ComplianceRules | null;
  trips: MileageLogRow[];
  vehicles: VehicleRow[];
  insets: { bottom: number };
  businessId: string | null;
  onEdit: (t: MileageLogRow) => void;
}> = ({ year, rules, trips, vehicles, insets, businessId, onEdit }) => {
  const { fullName } = useAuth();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [reporting, setReporting] = useState(false);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const businessRate = mileageRate(rules, year, 'business');
  const medicalRate = mileageRate(rules, year, 'medical');

  const totals = useMemo(() => {
    let bMiles = 0, bDed = 0, mMiles = 0, mDed = 0;
    for (const t of trips) {
      const miles = Number(t.total_miles) || 0;
      const ded = t.deduction_amount != null ? Number(t.deduction_amount) : 0;
      if (t.trip_type === 'medical') {
        mMiles += miles;
        mDed += ded;
      } else {
        bMiles += miles;
        bDed += ded;
      }
    }
    return { bMiles, bDed, mMiles, mDed };
  }, [trips]);

  const filtered = useMemo(
    () => (filter === 'all' ? trips : trips.filter((t) => (t.trip_type ?? 'business') === filter)),
    [trips, filter],
  );

  const onReport = async () => {
    setReporting(true);
    try {
      await generateMileageReport({ clientName: fullName ?? 'Client', businessId, year });
    } catch (e) {
      Alert.alert('Could not generate report', e instanceof Error ? e.message : String(e));
    } finally {
      setReporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.historyHeaderRow}>
        <Text style={styles.summaryTitle}>{year} Summary</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onReport}
          disabled={reporting}
          style={styles.reportBtn}
        >
          {reporting ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={14} color={colors.white} />
              <Text style={styles.reportBtnText}>Generate Report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.summaryCard}>
        <SummaryRow label="Total business miles" value={`${totals.bMiles} miles`} />
        <SummaryRow label="Estimated business deduction" value={money(totals.bDed)} gold />
        <SummaryRow label="Total medical miles" value={`${totals.mMiles} miles`} />
        <SummaryRow label="Estimated medical deduction" value={money(totals.mDed)} gold />
        <SummaryRow
          label="Combined estimated deduction"
          value={money(totals.bDed + totals.mDed)}
          gold
          bold
        />
      </View>

      <View style={styles.filterRow}>
        {(['all', 'business', 'medical'] as const).map((f) => {
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              activeOpacity={0.8}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {f === 'all' ? 'All' : f === 'business' ? 'Business' : 'Medical'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>
            No trips logged for {year}. Use Log Miles to add one.
          </Text>
        </View>
      ) : (
        filtered.map((t) => {
          const isMedical = t.trip_type === 'medical';
          return (
            <TouchableOpacity
              key={t.id}
              activeOpacity={0.8}
              onPress={() => onEdit(t)}
              style={styles.tripRow}
            >
              <View style={styles.tripRowMain}>
                <Text style={styles.tripDate}>{formatMMMDD(t.trip_date)}</Text>
                <Text style={styles.tripVehicle} numberOfLines={1}>
                  {vehicleLabel(t.vehicle_id ? vehicleById.get(t.vehicle_id) : null)}
                </Text>
              </View>
              <Text style={styles.tripMiles}>{Number(t.total_miles) || 0}</Text>
              <View
                style={[
                  styles.typeBadge,
                  isMedical ? styles.typeBadgeMedical : styles.typeBadgeBusiness,
                ]}
              >
                <Text style={styles.typeBadgeText}>{isMedical ? 'Medical' : 'Business'}</Text>
              </View>
              <Text style={styles.tripDeduction}>
                {money(t.deduction_amount != null ? Number(t.deduction_amount) : 0)}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.subtleText} />
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
};

const SummaryRow: React.FC<{
  label: string;
  value: string;
  gold?: boolean;
  bold?: boolean;
}> = ({ label, value, gold, bold }) => (
  <View style={styles.summaryRow}>
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text
      style={[
        styles.summaryValue,
        gold && styles.summaryValueGold,
        bold && styles.summaryValueBold,
      ]}
    >
      {value}
    </Text>
  </View>
);

// ── Vehicles tab ─────────────────────────────────────────────────────────────

const VehiclesTab: React.FC<{
  vehicles: VehicleRow[];
  insets: { bottom: number };
  onAdd: () => void;
  onEdit: (v: VehicleRow) => void;
  onToggleActive: () => Promise<void> | void;
}> = ({ vehicles, insets, onAdd, onEdit, onToggleActive }) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (v: VehicleRow, next: boolean) => {
    setBusyId(v.id);
    try {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('vehicles')
        .update({ is_active: next })
        .eq('id', v.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onToggleActive();
    } catch (e) {
      Alert.alert('Could not update vehicle', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.historyHeaderRow}>
        <Text style={styles.summaryTitle}>Vehicles</Text>
        <TouchableOpacity activeOpacity={0.85} onPress={onAdd} style={styles.reportBtn}>
          <Ionicons name="add" size={16} color={colors.white} />
          <Text style={styles.reportBtnText}>Add Vehicle</Text>
        </TouchableOpacity>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>
            No vehicles yet. Add one to start logging miles.
          </Text>
        </View>
      ) : (
        vehicles.map((v) => (
          <View key={v.id} style={styles.vehicleRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.vehicleMain}
              onPress={() => onEdit(v)}
            >
              <Text style={styles.vehicleTitle}>{vehicleYmm(v)}</Text>
              {v.nickname ? <Text style={styles.vehicleNickname}>{v.nickname}</Text> : null}
            </TouchableOpacity>
            {busyId === v.id ? (
              <ActivityIndicator color={colors.teal} />
            ) : (
              <Switch
                value={v.is_active}
                onValueChange={(next) => toggle(v, next)}
                trackColor={{ false: '#CCCCCC', true: colors.teal }}
                thumbColor={colors.white}
              />
            )}
            <TouchableOpacity onPress={() => onEdit(v)} hitSlop={8} style={styles.editIcon}>
              <Ionicons name="pencil" size={16} color={colors.midNavy} />
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={16} color={colors.subtleText} />
          </View>
        ))
      )}
    </ScrollView>
  );
};

// ── Vehicle edit / add sheet ──────────────────────────────────────────────────

const VehicleEditSheet: React.FC<{
  target: VehicleRow | 'new' | null;
  businessId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}> = ({ target, businessId, onClose, onSaved }) => {
  const isNew = target === 'new';
  const vehicle = target && target !== 'new' ? target : null;
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [nickname, setNickname] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setYear(vehicle?.year != null ? String(vehicle.year) : '');
    setMake(vehicle?.make ?? '');
    setModel(vehicle?.model ?? '');
    setNickname(vehicle?.nickname ?? '');
    setActive(vehicle?.is_active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const save = async () => {
    if (!make.trim() || !model.trim()) {
      Alert.alert('Missing info', 'Make and model are required.');
      return;
    }
    setSaving(true);
    try {
      const userId = await requireUserId();
      const payload = {
        year: year.trim() ? parseNum(year) : null,
        make: make.trim(),
        model: model.trim(),
        nickname: nickname.trim() || null,
        is_active: active,
      };
      if (vehicle) {
        const { error } = await supabase
          .from('vehicles')
          .update(payload)
          .eq('id', vehicle.id)
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('vehicles')
          .insert({ ...payload, user_id: userId, business_id: businessId });
        if (error) throw new Error(error.message);
      }
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save vehicle', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const isDirty = (): boolean => {
    if (isNew) return !!(year.trim() || make.trim() || model.trim() || nickname.trim());
    return (
      year !== (vehicle?.year != null ? String(vehicle.year) : '') ||
      make !== (vehicle?.make ?? '') ||
      model !== (vehicle?.model ?? '') ||
      nickname !== (vehicle?.nickname ?? '') ||
      active !== (vehicle?.is_active ?? true)
    );
  };

  // Tapping outside no longer dismisses the form; closing only happens via the
  // X / Cancel buttons, and only after confirming when there are edits to lose.
  const handleClose = () => {
    if (saving) return;
    if (!isDirty()) {
      onClose();
      return;
    }
    Alert.alert('Discard changes?', 'Your vehicle information will not be saved.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavFill}
          keyboardVerticalOffset={100}
        >
          <View style={styles.editSheet}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, styles.sheetTitleFlex]}>
                {isNew ? 'Add Vehicle' : 'Edit Vehicle'}
              </Text>
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={8}>
                <Text style={[styles.headerSave, saving && styles.headerSaveDim]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} hitSlop={8} style={styles.headerClose}>
                <Ionicons name="close" size={22} color={colors.mutedText} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.fieldLabel}>Vehicle year</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 2022"
                placeholderTextColor={colors.subtleText}
                keyboardType="numeric"
                maxLength={4}
                value={year}
                onChangeText={setYear}
              />
              <Text style={[styles.fieldLabel, styles.gapTop]}>Make</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Toyota"
                placeholderTextColor={colors.subtleText}
                value={make}
                onChangeText={setMake}
              />
              <Text style={[styles.fieldLabel, styles.gapTop]}>Model</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Camry"
                placeholderTextColor={colors.subtleText}
                value={model}
                onChangeText={setModel}
              />
              <Text style={[styles.fieldLabel, styles.gapTop]}>Nickname (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder='e.g. "Company Truck"'
                placeholderTextColor={colors.subtleText}
                value={nickname}
                onChangeText={setNickname}
              />
              <View style={styles.activeRow}>
                <Text style={styles.fieldLabel}>Active</Text>
                <Switch
                  value={active}
                  onValueChange={setActive}
                  trackColor={{ false: '#CCCCCC', true: colors.teal }}
                  thumbColor={colors.white}
                />
              </View>

              <View style={styles.sheetActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.flexBtn, saving && styles.btnDim]}
                  onPress={save}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ── Trip edit sheet ─────────────────────────────────────────────────────────

const TripEditSheet: React.FC<{
  trip: MileageLogRow | null;
  rules: ComplianceRules | null;
  vehicles: VehicleRow[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}> = ({ trip, rules, vehicles, onClose, onSaved }) => {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [tripType, setTripType] = useState<MileageTripType>('business');
  const [tripDate, setTripDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startOdo, setStartOdo] = useState('');
  const [endOdo, setEndOdo] = useState('');
  const [override, setOverride] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!trip) return;
    setVehicleId(trip.vehicle_id);
    setTripType((trip.trip_type ?? 'business') as MileageTripType);
    setTripDate(parseISODate(trip.trip_date) ?? new Date());
    setStartOdo(trip.start_odometer != null ? String(trip.start_odometer) : '');
    setEndOdo(trip.end_odometer != null ? String(trip.end_odometer) : '');
    // If there were no odometer readings, seed the override with total miles.
    setOverride(
      trip.start_odometer == null && trip.total_miles != null
        ? String(trip.total_miles)
        : '',
    );
    setPurpose(trip.purpose ?? '');
  }, [trip]);

  const calculated = useMemo(() => {
    const s = parseNum(startOdo);
    const e = parseNum(endOdo);
    if (!startOdo || !endOdo || e < s) return null;
    return e - s;
  }, [startOdo, endOdo]);

  const totalMiles = override.trim() !== '' ? parseNum(override) : calculated ?? 0;
  const year = trip?.tax_year ?? new Date().getFullYear();
  const rate = mileageRate(rules, year, tripType);
  const deduction = totalMiles * rate;

  const save = async () => {
    if (!trip) return;
    if (totalMiles <= 0) {
      Alert.alert('Enter miles', 'Enter odometer readings or a total-miles value.');
      return;
    }
    setSaving(true);
    try {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('mileage_log')
        .update({
          vehicle_id: vehicleId,
          trip_type: tripType,
          trip_date: toISODate(tripDate),
          start_odometer: override.trim() === '' ? parseNum(startOdo) || null : null,
          end_odometer: override.trim() === '' ? parseNum(endOdo) || null : null,
          total_miles: totalMiles,
          purpose: purpose.trim() || null,
          deduction_amount: deduction,
        })
        .eq('id', trip.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save trip', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const isDirty = (): boolean => {
    if (!trip) return false;
    const initOverride =
      trip.start_odometer == null && trip.total_miles != null ? String(trip.total_miles) : '';
    return (
      vehicleId !== trip.vehicle_id ||
      tripType !== ((trip.trip_type ?? 'business') as MileageTripType) ||
      startOdo !== (trip.start_odometer != null ? String(trip.start_odometer) : '') ||
      endOdo !== (trip.end_odometer != null ? String(trip.end_odometer) : '') ||
      override !== initOverride ||
      purpose !== (trip.purpose ?? '')
    );
  };

  // Tapping outside no longer dismisses the form; closing only happens via the
  // X / Cancel buttons, and only after confirming when there are edits to lose.
  const handleClose = () => {
    if (saving) return;
    if (!isDirty()) {
      onClose();
      return;
    }
    Alert.alert('Discard changes?', 'Your trip changes will not be saved.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const remove = () => {
    if (!trip) return;
    Alert.alert('Delete trip', 'Delete this mileage entry? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            const userId = await requireUserId();
            const { error } = await supabase
              .from('mileage_log')
              .delete()
              .eq('id', trip.id)
              .eq('user_id', userId);
            if (error) throw new Error(error.message);
            await onSaved();
            onClose();
          } catch (e) {
            Alert.alert('Could not delete trip', e instanceof Error ? e.message : String(e));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={trip !== null} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavFill}
          keyboardVerticalOffset={100}
        >
          <View style={styles.editSheet}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, styles.sheetTitleFlex]}>Edit Trip</Text>
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={8}>
                <Text style={[styles.headerSave, saving && styles.headerSaveDim]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} hitSlop={8} style={styles.headerClose}>
                <Ionicons name="close" size={22} color={colors.mutedText} />
              </TouchableOpacity>
            </View>
          <ScrollView
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {vehicles.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>Vehicle</Text>
                <VehiclePicker vehicles={vehicles} value={vehicleId} onChange={setVehicleId} />
              </>
            ) : null}

            <Text style={[styles.fieldLabel, styles.gapTop]}>Trip type</Text>
            <TripTypeToggle value={tripType} onChange={setTripType} />

            <DateInputField
              label="Trip date"
              value={tripDate}
              onChange={setTripDate}
              minimumDate={MIN_TRIP_DATE}
              pickerVisible={showDatePicker}
              onPickerVisibleChange={setShowDatePicker}
              style={styles.gapTop}
            />
            <DatePickerModal
              visible={showDatePicker}
              title="Trip Date"
              value={tripDate}
              minimumDate={MIN_TRIP_DATE}
              onConfirm={(d) => {
                setTripDate(d);
                setShowDatePicker(false);
              }}
              onCancel={() => setShowDatePicker(false)}
            />

            <View style={styles.fieldRow}>
              <View style={styles.flexHalf}>
                <Text style={styles.fieldLabel}>Starting Odometer</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 45230"
                  placeholderTextColor={colors.subtleText}
                  keyboardType="numeric"
                  value={startOdo}
                  onChangeText={setStartOdo}
                />
              </View>
              <View style={styles.fieldGap} />
              <View style={styles.flexHalf}>
                <Text style={styles.fieldLabel}>Ending Odometer</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 45287"
                  placeholderTextColor={colors.subtleText}
                  keyboardType="numeric"
                  value={endOdo}
                  onChangeText={setEndOdo}
                />
              </View>
            </View>

            {calculated != null ? (
              <View style={styles.calcCard}>
                <Ionicons name="calculator-outline" size={16} color={colors.teal} />
                <Text style={styles.calcText}>Calculated: {calculated} miles</Text>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, styles.gapTop]}>Or enter total miles directly</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 57"
              placeholderTextColor={colors.subtleText}
              keyboardType="numeric"
              value={override}
              onChangeText={setOverride}
            />

            <Text style={[styles.fieldLabel, styles.gapTop]}>Business purpose</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="Describe the purpose of this trip"
              placeholderTextColor={colors.subtleText}
              multiline
              value={purpose}
              onChangeText={setPurpose}
            />

            {totalMiles > 0 ? (
              <View style={styles.deductionCard}>
                <Text style={styles.deductionLabel}>Estimated deduction:</Text>
                <Text style={styles.deductionValue}>
                  {money(deduction)} ({totalMiles} miles × ${rate.toFixed(2)}/mile)
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.btnDim]}
              onPress={save}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={remove} disabled={saving}>
              <Ionicons name="trash-outline" size={16} color="#A32D2D" />
              <Text style={styles.deleteBtnText}>Delete Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flexFill: { flex: 1 },
  kavFill: { width: '100%' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sheetTitleFlex: { flex: 1, marginBottom: 0 },
  headerSave: { color: colors.navy, fontWeight: '700', fontSize: 15 },
  headerSaveDim: { opacity: 0.5 },
  headerClose: { padding: 2 },
  sheetScrollContent: { flexGrow: 1, paddingBottom: 40 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  tabBtnActive: { backgroundColor: colors.navy },
  tabLabel: { ...typography.caption, color: colors.mutedText, fontWeight: '600', fontSize: 12 },
  tabLabelActive: { color: colors.white },
  body: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 11,
    marginBottom: 6,
  },
  subLabel: { ...typography.caption, color: colors.subtleText, fontSize: 11, marginBottom: 6, marginTop: -2 },
  gapTop: { marginTop: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.bodyText,
    backgroundColor: colors.white,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  fieldRow: { flexDirection: 'row', marginTop: spacing.lg },
  fieldGap: { width: spacing.md },
  flexHalf: { flex: 1 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.white,
  },
  dropdownText: { flex: 1, ...typography.bodyMedium, color: colors.bodyText, fontSize: 14 },
  emptyVehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.lightBlue,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyVehicleText: { ...typography.bodyMedium, color: colors.navy, fontSize: 13 },
  addVehicleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.navy,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addVehicleBtnText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  segmentRow: { flexDirection: 'row', gap: spacing.sm },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.white,
  },
  segBusiness: { backgroundColor: colors.navy, borderColor: colors.navy },
  segMedical: { backgroundColor: colors.teal, borderColor: colors.teal },
  segmentLabel: { ...typography.bodyMedium, color: colors.navy, fontWeight: '700', fontSize: 13 },
  segmentLabelActive: { color: colors.white },
  calcCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.tealLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: spacing.md,
  },
  calcText: { ...typography.bodyMedium, color: colors.teal, fontWeight: '700', fontSize: 14 },
  amberNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  amberNoteText: { ...typography.caption, color: colors.amber, fontSize: 11, fontWeight: '600' },
  deductionCard: {
    backgroundColor: colors.tealLight,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  deductionLabel: { ...typography.caption, color: colors.teal, fontWeight: '700', fontSize: 12 },
  deductionValue: { ...typography.bodyMedium, color: colors.teal, fontWeight: '700', fontSize: 15, marginTop: 4 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  flexBtn: { flex: 1, marginTop: 0 },
  btnDim: { opacity: 0.7 },
  // History
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  summaryTitle: { ...typography.h2, color: colors.bodyText },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.navy,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reportBtnText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  summaryCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  summaryLabel: { ...typography.body, color: colors.mutedText, fontSize: 13 },
  summaryValue: { ...typography.bodyMedium, color: colors.bodyText, fontSize: 14, fontWeight: '600' },
  summaryValueGold: { color: colors.amber, fontWeight: '700' },
  summaryValueBold: { fontSize: 15 },
  filterRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.white,
  },
  filterChipActive: { backgroundColor: colors.midNavy, borderColor: colors.midNavy },
  filterChipText: { ...typography.caption, color: colors.mutedText, fontWeight: '600' },
  filterChipTextActive: { color: colors.white },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  tripRowMain: { flex: 1 },
  tripDate: { ...typography.caption, color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  tripVehicle: { ...typography.bodyMedium, color: colors.bodyText, fontSize: 13, marginTop: 2 },
  tripMiles: { ...typography.h3, color: colors.bodyText, fontSize: 18, fontWeight: '700' },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  typeBadgeBusiness: { backgroundColor: colors.navy },
  typeBadgeMedical: { backgroundColor: colors.teal },
  typeBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  tripDeduction: { ...typography.bodyMedium, color: colors.amber, fontWeight: '700', fontSize: 13 },
  emptyText: { ...typography.body, color: colors.mutedText, textAlign: 'center' },
  // Vehicles
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  vehicleMain: { flex: 1 },
  vehicleTitle: { ...typography.h3, color: colors.bodyText, fontSize: 15 },
  vehicleNickname: { ...typography.caption, color: colors.mutedText, marginTop: 2 },
  editIcon: { padding: 4 },
  // Dropdown / sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  sheet: { backgroundColor: colors.white, borderRadius: radius.card, padding: spacing.lg, gap: 2 },
  sheetTitle: { ...typography.h2, color: colors.bodyText, marginBottom: spacing.md },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
  },
  optionRowActive: { backgroundColor: colors.tealLight },
  optionText: { ...typography.bodyMedium, color: colors.bodyText, fontSize: 15 },
  optionTextActive: { color: colors.teal, fontWeight: '700' },
  editSheet: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  cancelBtnText: { ...typography.bodyMedium, color: colors.mutedText, fontWeight: '600' },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  deleteBtnText: { color: '#A32D2D', fontWeight: '700', fontSize: 14 },
});
