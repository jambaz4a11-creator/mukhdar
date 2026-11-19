// حقول التصميم المعتمد للسائق (Login، Register، ChangePin): الرقم بشارة +964، الـ PIN بزر إظهار/إخفاء، والاسم.
// الرقم والرمز من اليسار لليمين (أرقام لاتينية) داخل الواجهة العربية. نسخة من مكوّن تطبيق الزبون
// (SPEC-driver افتراض 6: لا packages/ui بالنسخة الأولى).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ar } from '../i18n/ar';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export function FieldLabel({ text }: { text: string }) {
  return (
    <AppText weight="semibold" size="small">
      {text}
    </AppText>
  );
}

export function PhoneField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.group}>
      <FieldLabel text={ar.fields.phone} />
      <View style={styles.box}>
        <View style={styles.prefix}>
          <AppText weight="semibold" style={styles.prefixText}>
            +964
          </AppText>
        </View>
        <TextInput
          testID="phone-input"
          accessibilityLabel={ar.fields.phone}
          value={value}
          onChangeText={onChangeText}
          placeholder={ar.fields.phonePlaceholder}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={20}
          style={[styles.input, styles.phoneInput]}
        />
      </View>
    </View>
  );
}

export function NameField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.group}>
      <FieldLabel text={ar.fields.name} />
      <TextInput
        testID="name-input"
        accessibilityLabel={ar.fields.name}
        value={value}
        onChangeText={onChangeText}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        maxLength={80}
        style={[styles.box, styles.nameInput]}
      />
    </View>
  );
}

export function PinField({
  label,
  value,
  onChangeText,
  testID,
  isNew = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  testID: string;
  /** حساب جديد: يقترح مدير كلمات السر حفظ الرمز */
  isNew?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.group}>
      <FieldLabel text={label} />
      <View style={[styles.box, styles.pinBox]}>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          keyboardType="number-pad"
          textContentType={isNew ? 'newPassword' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          maxLength={6}
          style={[styles.input, styles.pinInput]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? ar.fields.hidePin : ar.fields.showPin}
          testID={`${testID}-toggle`}
          onPress={() => setVisible((v) => !v)}
          style={styles.eye}
        >
          <Ionicons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={colors.textMuted}
          />
        </Pressable>
      </View>
    </View>
  );
}

export function FormMessage({ text, tone = 'error' }: { text: string; tone?: 'error' | 'info' }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.message, tone === 'info' ? styles.info : styles.error]}
    >
      <AppText size="small" color={tone === 'info' ? colors.primary : colors.danger}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  box: {
    flexDirection: 'row',
    direction: 'ltr',
    height: sizes.primaryButton,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
  },
  pinBox: { paddingLeft: spacing.md, paddingRight: 6 },
  prefix: {
    height: '100%',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  prefixText: { textAlign: 'left', writingDirection: 'ltr' },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    color: colors.text,
    fontFamily: fonts.regular,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  phoneInput: { paddingHorizontal: spacing.md, fontSize: fontSizes.title },
  nameInput: {
    paddingHorizontal: spacing.md,
    fontSize: fontSizes.body + 1,
    fontFamily: fonts.regular,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pinInput: { fontSize: fontSizes.heading, letterSpacing: 8 },
  eye: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { borderRadius: radius.control, padding: spacing.md },
  error: { backgroundColor: colors.dangerSoft },
  info: { backgroundColor: colors.primarySoft },
});
