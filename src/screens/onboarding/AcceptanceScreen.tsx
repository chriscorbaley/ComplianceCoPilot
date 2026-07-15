import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { contentContainerStyle } from '../../constants/layout';

interface AcceptanceScreenProps {
  title: string;
  effectiveDate: string;
  body: string;
  checkboxLabel: string;
  busy?: boolean;
  // While true the document text is still being fetched: show a spinner in the
  // body and keep the acceptance controls disabled.
  loading?: boolean;
  onAccept: () => void | Promise<void>;
}

export const AcceptanceScreen: React.FC<AcceptanceScreenProps> = ({
  title,
  effectiveDate,
  body,
  checkboxLabel,
  busy = false,
  loading = false,
  onAccept,
}) => {
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = Math.max(1, contentSize.height - layoutMeasurement.height);
    setScrollPct(Math.min(1, Math.max(0, contentOffset.y / max)));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.effectiveDate}>{effectiveDate}</Text>

      <View style={styles.scrollWrap}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#185FA5" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={contentContainerStyle}>
              <Text style={styles.bodyText}>{body}</Text>
            </View>
          </ScrollView>
        )}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(scrollPct * 100)}%` }]} />
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={loading}
          onPress={() => setChecked(!checked)}
          style={styles.checkRow}
        >
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
          </View>
          <Text style={styles.checkLabel}>{checkboxLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={!checked || busy || loading}
          onPress={onAccept}
          style={[styles.continueBtn, (!checked || busy || loading) && styles.continueBtnDisabled]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.continueText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  brand: {
    alignItems: 'center',
    paddingTop: 8,
  },
  logo: {
    height: 60,
    width: undefined,
    aspectRatio: 1,
  },
  title: {
    color: '#042C53',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
  effectiveDate: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  scrollWrap: {
    flex: 1,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  bodyText: {
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 20,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#888888',
    fontSize: 13,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.divider,
  },
  progressFill: {
    height: 3,
    backgroundColor: '#185FA5',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 14,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#185FA5',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkboxOn: {
    backgroundColor: '#185FA5',
  },
  checkLabel: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '500',
  },
  continueBtn: {
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: '#C7CDD3',
  },
  continueText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
