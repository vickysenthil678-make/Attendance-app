import React from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput,
  View, type TextInputProps, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';

export const palette = {
  purple: '#667eea',
  violet: '#764ba2',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  red: '#dc2626',
  green: '#16a34a',
  purpleButton: '#7c3aed',
  white: '#ffffff',
  dark: '#1f2937',
  glass: 'rgba(255,255,255,0.14)',
};

export function Page({
  title, children, scroll = true, showCollegeHeader = true,
}: React.PropsWithChildren<{ title?: string; scroll?: boolean; showCollegeHeader?: boolean }>) {
  const navigation = useNavigation();
  const route = useRoute();
  const showBack = !['SignIn', 'Dashboard', 'ClassSelect'].includes(route.name) && navigation.canGoBack();
  const content = (
    <View style={styles.content}>
      {showBack && <Button title="← Back" tone="clear" compact onPress={() => navigation.goBack()} />}
      {title ? <Text style={styles.pageTitle}>{title}</Text> : null}
      {children}
    </View>
  );
  return (
    <LinearGradient colors={[palette.purple, palette.violet]} style={styles.page}>
      {showCollegeHeader && <CollegeHeader />}
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>{content}</ScrollView> : content}
    </LinearGradient>
  );
}

export function CollegeHeader() {
  return (
    <View style={styles.header}>
      <Image source={require('../assets/college-logo.png')} style={styles.logo} resizeMode="contain" />
      <View style={styles.collegeInfo}>
        <Text numberOfLines={2} style={styles.collegeName}>THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)</Text>
        <Text style={styles.collegeLine}>(Affiliated to Bharathidasan University)</Text>
        <Text style={styles.collegeLine}>Accredited with ‘A’Grade by NAAC (3rd cycle) with CGPA 3.23 out of 4</Text>
        <Text style={styles.collegeLine}>ELAMBALUR (P.O), PERAMBALUR – 621 220</Text>
        <Text style={styles.systemTitle}>Attendance Maintenance System</Text>
      </View>
      <Image source={require('../assets/college-mark.png')} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title, onPress, tone = 'blue', disabled = false, compact = false, style,
}: { title: string; onPress: () => void; tone?: 'blue' | 'red' | 'green' | 'purple' | 'clear'; disabled?: boolean; compact?: boolean; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [
      styles.button,
      styles[`button_${tone}`],
      compact && styles.buttonCompact,
      style,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
    ]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, multiline, style, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor="rgba(255,255,255,0.75)"
        style={[styles.input, multiline && styles.multiline, style]}
      />
    </View>
  );
}

export function ChoiceRow({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => (
          <Pressable key={option} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Notice({ children, tone = 'info' }: React.PropsWithChildren<{ tone?: 'info' | 'error' | 'success' }>) {
  if (!children) return null;
  return <Text style={[styles.notice, styles[`notice_${tone}`]]}>{children}</Text>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={palette.white} /><Text style={styles.loadingText}>{label}</Text></View>;
}

export function Row({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export const uiStyles = StyleSheet.create({
  heading: { color: palette.white, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  body: { color: palette.white, fontSize: 14, lineHeight: 20 },
  muted: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 18 },
  item: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.25)', paddingVertical: 12, gap: 5 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 10 },
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { paddingBottom: 36 },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16 },
  header: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#ffffff',
    borderBottomWidth: 2, borderBottomColor: '#e5e7eb',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  logo: { width: 50, height: 44, flexShrink: 0 },
  collegeInfo: { flex: 1, alignItems: 'center', marginHorizontal: 8 },
  collegeName: { color: '#111827', fontSize: 12, lineHeight: 15, fontWeight: '800', textAlign: 'center' },
  collegeLine: { color: '#4b5563', fontSize: 9.5, lineHeight: 12, textAlign: 'center' },
  systemTitle: { color: '#1e3a8a', fontSize: 11, lineHeight: 14, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center', marginTop: 2 },
  pageTitle: { color: palette.white, fontSize: 21, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  card: {
    width: '100%', padding: 16, marginBottom: 14, backgroundColor: palette.glass,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
  },
  button: {
    minHeight: 44, borderRadius: 100, paddingHorizontal: 16, paddingVertical: 10,
    margin: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blue,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 5, shadowOffset: { width: 0, height: 2 },
  },
  button_blue: { backgroundColor: palette.blue },
  button_red: { backgroundColor: palette.red },
  button_green: { backgroundColor: palette.green },
  button_purple: { backgroundColor: palette.purpleButton },
  button_clear: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  buttonCompact: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 7 },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: palette.white, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  fieldWrap: { marginVertical: 5, width: '100%' },
  label: { color: palette.white, fontSize: 13, fontWeight: '600', marginBottom: 5 },
  input: {
    minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.2)', color: palette.white, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14,
  },
  multiline: { minHeight: 86, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  choiceSelected: { backgroundColor: palette.blue, borderColor: '#ffffff' },
  choiceText: { color: palette.white, fontSize: 13, fontWeight: '600' },
  notice: { color: palette.white, padding: 10, borderRadius: 8, marginVertical: 8, overflow: 'hidden' },
  notice_info: { backgroundColor: 'rgba(0,0,0,0.15)' },
  notice_error: { backgroundColor: 'rgba(239,68,68,0.3)', color: '#fee2e2' },
  notice_success: { backgroundColor: 'rgba(34,197,94,0.2)', color: '#dcfce7' },
  loading: { padding: 18, alignItems: 'center', gap: 8 },
  loadingText: { color: palette.white, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
