// Shared image-picker helper (Fix 4). Presents an action sheet with "Choose
// Photo" / "Take Photo" / "Cancel", requests the matching OS permission before
// launching, and — when permission is denied — offers to open the device
// Settings so the user can grant access. Returns the picked local URI, or null
// when the user cancels or permission is denied.
//
// Centralized here so every image upload in the app (business logo on
// onboarding and Settings, and any future image uploads) shares identical
// permission handling and UX.

import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// Square-crop defaults, right for a logo. Callers that need the full,
// uncropped image (e.g. a rate-comparable screenshot) pass
// `{ allowsEditing: false }` to override these.
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

const showPermissionAlert = (message: string) => {
  Alert.alert('Permission Required', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open Settings', onPress: () => Linking.openSettings() },
  ]);
};

// Per-call overrides merged over PICKER_OPTIONS so each upload can tune the
// picker (crop vs. full image, quality, etc.) while sharing permission UX.
type PickerOverrides = Partial<ImagePicker.ImagePickerOptions>;

// Prompt for photo-library access, then open the library. Returns the picked
// URI or null (cancelled / denied).
export const pickFromLibrary = async (
  overrides?: PickerOverrides,
): Promise<string | null> => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    showPermissionAlert(
      'Please allow access to your photo library to upload images. ' +
        'You can enable this in your device Settings under Privacy > Photos.',
    );
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    ...PICKER_OPTIONS,
    ...overrides,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
};

// Prompt for camera access, then open the camera. Returns the captured URI or
// null (cancelled / denied).
export const takePhoto = async (
  overrides?: PickerOverrides,
): Promise<string | null> => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    showPermissionAlert('Please allow camera access to take a photo.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    ...PICKER_OPTIONS,
    ...overrides,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
};

// Show the "Choose Photo / Take Photo / Cancel" action sheet and resolve with
// the picked local URI (or null if the user cancels or is denied permission).
export const pickImageWithSource = (
  overrides?: PickerOverrides,
): Promise<string | null> =>
  new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Choose Photo', 'Take Photo', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) resolve(pickFromLibrary(overrides));
          else if (index === 1) resolve(takePhoto(overrides));
          else resolve(null);
        },
      );
    } else {
      Alert.alert('Upload image', 'Choose a photo source', [
        { text: 'Choose Photo', onPress: () => resolve(pickFromLibrary(overrides)) },
        { text: 'Take Photo', onPress: () => resolve(takePhoto(overrides)) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
