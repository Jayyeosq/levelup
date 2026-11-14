// The app's settings live in app.json. This file only changes a few of them for the
// developer build (eas.json → development sets APP_VARIANT=development), so the
// developer app "LevelUp+ Dev" and the TestFlight/App Store app can sit side by side
// on one phone.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!IS_DEV) return config as ExpoConfig;
  return {
    ...config,
    name: 'LevelUp+ Dev',
    slug: config.slug!,
    scheme: 'levelup-dev',
    ios: { ...config.ios, bundleIdentifier: 'com.levelupplus.app.dev' },
    android: { ...config.android, package: 'com.levelupplus.app.dev' },
  };
};
