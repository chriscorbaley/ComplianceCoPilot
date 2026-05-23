import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export const SplashScreen: React.FC = () => {
  return (
    <View style={styles.root}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.tagline}>
        Your tax compliance, handled before tax season
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    height: 80,
    width: undefined,
    aspectRatio: 1,
  },
  tagline: {
    color: colors.white,
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
});
