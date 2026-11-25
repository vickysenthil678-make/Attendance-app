module.exports = {
  name: 'College Attendance System',
  slug: 'college-attendance-system',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  plugins: [
    'expo-secure-store',
    'expo-document-picker',
    [
      'expo-image-picker',
      {
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-sharing',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: process.env.EXPO_PUBLIC_API_URL?.startsWith('http://') || false,
        },
      },
    ],
  ],
  ios: {
    bundleIdentifier: 'edu.thrc.collegeattendance',
    supportsTablet: true,
  },
  android: {
    package: 'edu.thrc.collegeattendance',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
};
