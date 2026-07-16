import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, shadow, typography } from '../theme';
import { scaled } from '../constants/layout';
import {
  classifyFromRecording,
  ensureMicPermission,
  startRecording,
  MissingProxyError,
  ProxyUnreachableError,
} from '../services/openai';
import { publish } from '../services/voiceInbox';
import { routeFromClassification } from '../services/openai';
import { useKeepAwakeWhile } from '../hooks/useKeepAwakeWhile';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { useFeatureFlag } from '../context/FeatureFlagContext';
import { KeepAwakeIndicator } from './KeepAwakeIndicator';
import { VoiceUnavailableNotice } from './VoiceUnavailableNotice';
import { VoiceUpgradeSheet } from './VoiceUpgradeSheet';

type Phase = 'idle' | 'recording' | 'processing';

interface VoiceLogStripProps {
  hint?: string;
}

export const VoiceLogStrip: React.FC<VoiceLogStripProps> = ({
  hint = 'Tap to log hours, expenses, or a meeting',
}) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  // Voice logging is a Core/Pro feature. Basic subscribers keep the mic button
  // in place but it turns amber and opens the upgrade sheet instead of recording.
  const { canUseVoice } = useStrategyAccess();
  // Global feature flag — when voice is turned off firm-wide the mic is hidden
  // entirely (separate from the tier-based amber-upgrade behavior below).
  const voiceFeaturesEnabled = useFeatureFlag('voice_features');
  const [phase, setPhase] = useState<Phase>('idle');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const recRef = useRef<Audio.Recording | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  useKeepAwakeWhile(phase === 'recording', 'voice-strip');

  useEffect(() => {
    if (phase !== 'recording') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) r.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const onPress = async () => {
    if (phase === 'processing') return;
    if (!canUseVoice) {
      setShowUpgrade(true);
      return;
    }
    if (phase === 'recording') {
      const rec = recRef.current;
      recRef.current = null;
      if (!rec) {
        setPhase('idle');
        return;
      }
      setPhase('processing');
      try {
        const { note } = await classifyFromRecording(rec);
        publish(note);
        routeFromClassification(navigation as never, CommonActions, note);
      } catch (e) {
        console.warn('[voice-strip] voice log failed', e);
        if (e instanceof MissingProxyError) {
          Alert.alert('Proxy not configured', e.message);
        } else if (e instanceof ProxyUnreachableError) {
          Alert.alert('Proxy unreachable', e.message);
        } else {
          Alert.alert('Voice log failed', e instanceof Error ? e.message : String(e));
        }
      } finally {
        setPhase('idle');
      }
      return;
    }

    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'Enable microphone access in Settings to use voice logging.',
        );
        return;
      }
      const rec = await startRecording();
      recRef.current = rec;
      setPhase('recording');
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e));
    }
  };

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  if (!voiceFeaturesEnabled) {
    return (
      <View
        style={[
          styles.container,
          { paddingBottom: spacing.sm + insets.bottom },
        ]}
      >
        <VoiceUnavailableNotice />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: spacing.sm + insets.bottom },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        disabled={phase === 'processing'}
        style={styles.strip}
      >
        <Animated.View
          style={[
            styles.micButton,
            {
              backgroundColor:
                phase === 'recording'
                  ? '#E0352B'
                  : canUseVoice
                    ? colors.navy
                    : colors.amber,
              transform: [{ scale: phase === 'recording' ? pulseScale : 1 }],
            },
          ]}
        >
          {phase === 'processing' ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons
              name={phase === 'recording' ? 'stop' : 'mic'}
              size={20}
              color={colors.white}
            />
          )}
        </Animated.View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {phase === 'recording'
                ? 'Listening…'
                : phase === 'processing'
                  ? 'Routing your note…'
                  : 'Voice Log'}
            </Text>
            <KeepAwakeIndicator visible={phase === 'recording'} />
          </View>
          <Text style={styles.hint} numberOfLines={1}>
            {phase === 'recording'
              ? 'Tap to stop and route'
              : phase === 'processing'
                ? 'Transcribing & classifying'
                : hint}
          </Text>
        </View>
        <Ionicons
          name={phase === 'recording' ? 'radio-button-on' : 'chevron-forward'}
          size={18}
          color={phase === 'recording' ? '#E0352B' : colors.mutedText}
        />
      </TouchableOpacity>
      <VoiceUpgradeSheet
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: 'transparent',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingVertical: scaled(10),
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
    ...shadow.raised,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
  },
  hint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 1,
  },
});
