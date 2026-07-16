import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// İskelet UI kiti — tek dosyada tutarlı temel bileşenler. Marka rengi ekran
// bazında prop'la gelir (resolve-org themeColor). Görsel cila Plan 4'te
// (enerjik görsel yön) — burada temiz/okunur/44pt dokunma hedefi yeter.

export const palette = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  sub: '#64748b',
  line: '#e2e8f0',
  danger: '#dc2626',
  brandFallback: '#7c3aed',
};

export function Screen({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={s.screen}>{children}</SafeAreaView>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Sub({ children }: { children: React.ReactNode }) {
  return <Text style={s.sub}>{children}</Text>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return <Text style={s.error}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={palette.sub} {...props} style={[s.input, props.style]} />;
}

export function Button({
  label,
  onPress,
  color = palette.brandFallback,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const bg = variant === 'primary' ? color : 'transparent';
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? palette.danger : color;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant !== 'primary' && { borderWidth: 1, borderColor: variant === 'danger' ? palette.danger : color },
      ]}
    >
      <Text style={[s.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function LoadingScreen() {
  return (
    <SafeAreaView style={[s.screen, s.center]}>
      <ActivityIndicator size="large" color={palette.brandFallback} />
    </SafeAreaView>
  );
}

// Tam ekran durum mesajı (bakım / güncelleme / offline).
export function StatusScreen({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <SafeAreaView style={[s.screen, s.center, { padding: 24 }]}>
      <Title>{title}</Title>
      <Text style={[s.sub, { textAlign: 'center', marginVertical: 12 }]}>{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: palette.text },
  sub: { fontSize: 15, color: palette.sub },
  error: { fontSize: 14, color: palette.danger, marginTop: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.card,
    marginTop: 10,
  },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 12 },
  btnLabel: { fontSize: 16, fontWeight: '600' },
  card: {
    backgroundColor: palette.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    marginTop: 12,
  },
});
