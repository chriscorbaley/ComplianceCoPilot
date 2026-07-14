import { Dimensions, ViewStyle } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export { SCREEN_WIDTH };

// Tablets (iPad et al.) report a portrait width of ~768px or more. Phones stay
// well below this, so a single threshold cleanly separates the two form factors.
// Orientation is locked to portrait app-wide, so this width is stable.
export const isTablet = SCREEN_WIDTH >= 768;

// On tablets, cap the main content column so it doesn't stretch uncomfortably
// across the full width. Phones are unconstrained (full width, exactly as before).
export const CONTENT_MAX_WIDTH = 600;

// Drop-in wrapper style for a screen's main content column. On tablets it caps
// the width at 600px and centers the column; on phones it is a no-op (full width,
// centered within an already-full-width parent) so existing phone layouts are
// unchanged. No horizontal padding is added here on purpose: every screen already
// supplies its own padding, and adding more would visibly change phone spacing.
export const contentContainerStyle: ViewStyle = {
  width: '100%',
  maxWidth: isTablet ? CONTENT_MAX_WIDTH : undefined,
  alignSelf: 'center',
};

// Touch targets feel small on the physically larger tablet screen, so nudge
// interactive element sizes up by 15%. Body text and card content are left
// alone on purpose — the 600px max width already handles readability.
export const tabletScale = isTablet ? 1.15 : 1.0;

export const scaled = (size: number): number => Math.round(size * tabletScale);

// Startup diagnostic: confirm tablet detection. Logs once when this module is
// first imported at app launch.
console.log(`[layout] SCREEN_WIDTH=${SCREEN_WIDTH} isTablet=${isTablet}`);
