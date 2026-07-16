import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import type { SubscriptionTier } from '../../services/supabase';
import {
  fetchAllPricingPlans,
  updatePricingPlan,
  formatPrice,
  formatAnnualPrice,
  type PricingPlan,
} from '../../services/pricingPlans';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminInput,
  AdminLoading,
  listStyles,
} from './_shared';

// Editor working copy — numbers are held as strings so partial input (e.g. an
// empty field mid-edit) doesn't get coerced to NaN until save.
interface EditorState {
  plan_key: SubscriptionTier;
  display_name: string;
  monthly_price: string;
  trial_days: string;
  is_active: boolean;
  features: string[];
  annual_price: string;
  annual_discount_pct: string;
  annual_enabled: boolean;
}

const toEditor = (p: PricingPlan): EditorState => ({
  plan_key: p.plan_key,
  display_name: p.display_name,
  monthly_price: String(p.monthly_price),
  trial_days: String(p.trial_days),
  is_active: p.is_active,
  features: [...p.features],
  annual_price: String(p.annual_price),
  annual_discount_pct: String(p.annual_discount_pct),
  annual_enabled: p.annual_enabled,
});

// round(monthly * 12 * (1 - pct/100)) — the suggested paid-in-full annual charge.
// Returns null when either input isn't a usable number so callers can no-op.
const suggestedAnnual = (monthly: string, pct: string): number | null => {
  const m = Number(monthly);
  const p = Number(pct);
  if (!Number.isFinite(m) || m < 0 || !Number.isFinite(p)) return null;
  return Math.round(m * 12 * (1 - p / 100));
};

export const PricingEditor: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [plans, setPlans] = useState<PricingPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const rows = await fetchAllPricingPlans();
      setError(null);
      setPlans(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setFeature = (i: number, text: string) => {
    if (!editor) return;
    const next = [...editor.features];
    next[i] = text;
    setEditor({ ...editor, features: next });
  };

  const addFeature = () => {
    if (!editor) return;
    setEditor({ ...editor, features: [...editor.features, ''] });
  };

  const removeFeature = (i: number) => {
    if (!editor) return;
    setEditor({ ...editor, features: editor.features.filter((_, idx) => idx !== i) });
  };

  const moveFeature = (i: number, dir: -1 | 1) => {
    if (!editor) return;
    const j = i + dir;
    if (j < 0 || j >= editor.features.length) return;
    const next = [...editor.features];
    [next[i], next[j]] = [next[j], next[i]];
    setEditor({ ...editor, features: next });
  };

  const save = async () => {
    if (!editor) return;
    const displayName = editor.display_name.trim();
    if (!displayName) {
      Alert.alert('Name required', 'Enter a display name for this plan.');
      return;
    }
    const price = Number(editor.monthly_price);
    if (!Number.isFinite(price) || price < 0) {
      Alert.alert('Invalid price', 'Enter a valid monthly price (a number ≥ 0).');
      return;
    }
    const trial = Number(editor.trial_days);
    if (!Number.isInteger(trial) || trial < 0) {
      Alert.alert('Invalid trial length', 'Enter a whole number of trial days (≥ 0).');
      return;
    }
    const annualPrice = Number(editor.annual_price);
    if (!Number.isFinite(annualPrice) || annualPrice < 0) {
      Alert.alert('Invalid annual price', 'Enter a valid annual price (a number ≥ 0).');
      return;
    }
    const annualPct = Number(editor.annual_discount_pct);
    if (!Number.isFinite(annualPct) || annualPct < 0 || annualPct > 100) {
      Alert.alert('Invalid discount', 'Enter an annual discount between 0 and 100 percent.');
      return;
    }
    const features = editor.features.map((f) => f.trim()).filter((f) => f.length > 0);

    setSaving(true);
    try {
      await updatePricingPlan(
        editor.plan_key,
        {
          display_name: displayName,
          monthly_price: price,
          trial_days: trial,
          is_active: editor.is_active,
          features,
          annual_price: annualPrice,
          annual_discount_pct: annualPct,
          annual_enabled: editor.annual_enabled,
        },
        session?.user.email ?? null,
      );
      setEditor(null);
      await load();
      Alert.alert('Saved', `${displayName} pricing updated. Changes reach client apps on their next launch.`);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
        {!plans && !error && <AdminLoading label="Loading pricing plans…" />}
        {error && (
          <AdminEmpty
            icon="alert-circle-outline"
            title="Could not load pricing plans"
            hint={error}
          />
        )}

        {plans &&
          plans.map((p) => (
            <AdminCard key={p.plan_key}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleRow}>
                  <Text style={listStyles.rowTitle}>{p.display_name}</Text>
                  <View style={styles.keyPill}>
                    <Text style={styles.keyPillText}>{p.plan_key}</Text>
                  </View>
                </View>
                {p.is_active ? (
                  <View style={styles.activePill}>
                    <Ionicons name="checkmark-circle" size={12} color={colors.teal} />
                    <Text style={styles.activePillText}>ACTIVE</Text>
                  </View>
                ) : (
                  <View style={styles.inactivePill}>
                    <Text style={styles.inactivePillText}>HIDDEN</Text>
                  </View>
                )}
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.priceText}>{formatPrice(p.monthly_price)}</Text>
                <Text style={styles.priceUnit}>/month</Text>
                <Text style={styles.trialText}>· {p.trial_days}-day trial</Text>
              </View>

              <View style={styles.annualRow}>
                <Text style={styles.annualText}>
                  {formatAnnualPrice(p.annual_price)} ({p.annual_discount_pct}% off)
                </Text>
                {p.annual_enabled ? (
                  <View style={styles.annualOnPill}>
                    <Text style={styles.annualOnText}>ANNUAL ON</Text>
                  </View>
                ) : (
                  <View style={styles.annualOffPill}>
                    <Text style={styles.annualOffText}>ANNUAL OFF</Text>
                  </View>
                )}
              </View>

              <View style={styles.featureList}>
                {p.features.length === 0 ? (
                  <Text style={styles.noFeatures}>No feature bullets</Text>
                ) : (
                  p.features.map((f, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.teal} />
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={listStyles.rowActions}>
                <AdminButton label="Edit" icon="create-outline" onPress={() => setEditor(toEditor(p))} />
              </View>
            </AdminCard>
          ))}
      </ScrollView>

      <Modal
        visible={editor !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setEditor(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setEditor(null)} hitSlop={12}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editor ? `Edit ${editor.plan_key} plan` : ''}
            </Text>
            <View style={{ width: 52 }} />
          </View>

          {editor && (
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <AdminInput
                label="Display name"
                value={editor.display_name}
                onChangeText={(t) => setEditor({ ...editor, display_name: t })}
                placeholder="e.g. Basic"
              />

              <AdminInput
                label="Monthly price (USD)"
                value={editor.monthly_price}
                onChangeText={(t) => setEditor({ ...editor, monthly_price: t.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="e.g. 49"
              />

              <AdminInput
                label="Trial days"
                value={editor.trial_days}
                onChangeText={(t) => setEditor({ ...editor, trial_days: t.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                placeholder="e.g. 3"
              />

              <View style={styles.annualDivider} />
              <Text style={styles.featuresLabel}>Annual (paid in full)</Text>

              <AdminInput
                label="Annual discount (%)"
                value={editor.annual_discount_pct}
                onChangeText={(t) =>
                  setEditor({ ...editor, annual_discount_pct: t.replace(/[^0-9.]/g, '') })
                }
                keyboardType="decimal-pad"
                placeholder="e.g. 10"
              />

              <AdminInput
                label="Annual price (USD, billed once/year)"
                value={editor.annual_price}
                onChangeText={(t) => setEditor({ ...editor, annual_price: t.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="e.g. 529"
              />

              {(() => {
                // Offer, don't force: compute round(monthly * 12 * (1 - pct/100))
                // and surface it as a one-tap suggestion. The admin can ignore it
                // and keep a hand-picked round number in the annual price field.
                const suggestion = suggestedAnnual(editor.monthly_price, editor.annual_discount_pct);
                if (suggestion === null) return null;
                const matches = Number(editor.annual_price) === suggestion;
                return (
                  <TouchableOpacity
                    onPress={() => setEditor({ ...editor, annual_price: String(suggestion) })}
                    disabled={matches}
                    activeOpacity={0.8}
                    style={[styles.suggestRow, matches && styles.suggestRowMatch]}
                  >
                    <Ionicons
                      name={matches ? 'checkmark-circle' : 'calculator-outline'}
                      size={16}
                      color={matches ? colors.teal : colors.midNavy}
                    />
                    <Text style={[styles.suggestText, matches && styles.suggestTextMatch]}>
                      {matches
                        ? `Annual price matches the ${editor.annual_discount_pct || 0}% calculation ($${suggestion})`
                        : `Suggested: $${suggestion} (monthly × 12 − ${editor.annual_discount_pct || 0}%). Tap to apply.`}
                    </Text>
                  </TouchableOpacity>
                );
              })()}

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Annual plan enabled</Text>
                  <Text style={styles.toggleHint}>
                    When off, the annual (paid-in-full) option is not offered for this plan.
                  </Text>
                </View>
                <Switch
                  value={editor.annual_enabled}
                  onValueChange={(v) => setEditor({ ...editor, annual_enabled: v })}
                  trackColor={{ true: colors.teal, false: colors.divider }}
                />
              </View>

              <View style={styles.annualDivider} />

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Active</Text>
                  <Text style={styles.toggleHint}>
                    When off, this plan is hidden from the Choose Your Plan screen.
                  </Text>
                </View>
                <Switch
                  value={editor.is_active}
                  onValueChange={(v) => setEditor({ ...editor, is_active: v })}
                  trackColor={{ true: colors.teal, false: colors.divider }}
                />
              </View>

              <Text style={styles.featuresLabel}>Feature bullets</Text>
              {editor.features.map((f, i) => (
                <View key={i} style={styles.editFeatureRow}>
                  <TextInput
                    value={f}
                    onChangeText={(t) => setFeature(i, t)}
                    style={styles.featureInput}
                    placeholder={`Bullet ${i + 1}`}
                    placeholderTextColor={colors.subtleText}
                  />
                  <TouchableOpacity
                    onPress={() => moveFeature(i, -1)}
                    disabled={i === 0}
                    hitSlop={8}
                    style={[styles.iconBtn, i === 0 && styles.iconBtnDisabled]}
                  >
                    <Ionicons name="chevron-up" size={18} color={colors.midNavy} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveFeature(i, 1)}
                    disabled={i === editor.features.length - 1}
                    hitSlop={8}
                    style={[styles.iconBtn, i === editor.features.length - 1 && styles.iconBtnDisabled]}
                  >
                    <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeFeature(i)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={18} color={colors.orangeAlert} />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity onPress={addFeature} style={styles.addFeatureBtn}>
                <Ionicons name="add-circle-outline" size={18} color={colors.midNavy} />
                <Text style={styles.addFeatureText}>Add bullet</Text>
              </TouchableOpacity>

              <View style={{ marginTop: spacing.lg }}>
                <AdminButton label="Save changes" icon="save-outline" onPress={save} loading={saving} />
                <Text style={styles.saveHint}>
                  plan_key stays fixed — only the shown name, price, trial, features, and
                  visibility change. Client apps pick up changes on their next launch.
                </Text>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  keyPill: {
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  keyPillText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 10,
    fontWeight: '700',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.tealLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  activePillText: {
    ...typography.micro,
    color: colors.teal,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  inactivePill: {
    backgroundColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  inactivePillText: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: spacing.sm,
  },
  priceText: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 22,
    fontWeight: '700',
  },
  priceUnit: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
  },
  trialText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginLeft: 4,
  },
  annualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  annualText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
  },
  annualOnPill: {
    backgroundColor: colors.tealLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  annualOnText: {
    ...typography.micro,
    color: colors.teal,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  annualOffPill: {
    backgroundColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  annualOffText: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  annualDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.lightBlue,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestRowMatch: {
    backgroundColor: colors.tealLight,
  },
  suggestText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    flex: 1,
  },
  suggestTextMatch: {
    color: colors.teal,
  },
  featureList: {
    marginTop: spacing.md,
    gap: 6,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  featureText: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 13,
    flex: 1,
  },
  noFeatures: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 12,
    fontStyle: 'italic',
  },
  // ── Editor modal ──
  modalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  modalCancel: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 15,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 16,
    textTransform: 'capitalize',
  },
  modalBody: {
    flex: 1,
  },
  modalContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    padding: spacing.md,
  },
  toggleLabel: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  featuresLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  editFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  featureInput: {
    ...typography.body,
    flex: 1,
    color: colors.bodyText,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: {
    opacity: 0.3,
  },
  addFeatureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  addFeatureText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 14,
    fontWeight: '600',
  },
  saveHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
