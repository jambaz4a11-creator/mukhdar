// نموذج العنوان (T12، تصميم AddressNew): القطاع ← الوحدة ← رقم العمارة (يُكتب ويُتحقق منه مقابل عمارات
// الوحدة النشطة) ← الشقة، مع التسمية والملاحظة والافتراضي. تغيير القطاع يمسح الوحدة والعمارة؛ تغيير الوحدة يمسح العمارة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorMessage, formatAddress, formatSector } from '@mukhdar/shared';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ADDRESS_LABELS,
  APARTMENT_MAX,
  BUILDING_MAX_DIGITS,
  createAddress,
  type CustomerAddress,
  indexBuildings,
  normalizeBuildingInput,
  NOTE_MAX,
  updateAddress,
} from '../features/addresses/api';
import {
  useBuildings,
  useInvalidateAddresses,
  useSectors,
  useSubsections,
} from '../features/addresses/hooks';
import { useSelectedAddress } from '../features/addresses/selected';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { getSupabase } from '../lib/supabase';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { FormMessage } from './AuthFields';
import { PrimaryButton } from './PrimaryButton';

const UNIT_COLUMNS = 5;

interface Props {
  /** عنوان للتعديل؛ بدونه = عنوان جديد. */
  initial?: CustomerAddress;
  /** أول عنوان للزبون: يصير افتراضياً إجبارياً. */
  isFirst: boolean;
  /** "الخطوة 2 من 2" بعد شاشة الاسم. */
  onboarding?: boolean;
  onBack: () => void;
  onSaved: (id: string) => void;
}

export function AddressForm({ initial, isFirst, onboarding = false, onBack, onSaved }: Props) {
  const session = useAuth((s) => s.session);
  const invalidate = useInvalidateAddresses();
  const selectAddress = useSelectedAddress((s) => s.select);
  const { width } = useWindowDimensions();
  const unitWidth = (width - spacing.screen * 2 - spacing.xs * (UNIT_COLUMNS - 1)) / UNIT_COLUMNS;

  const sub = initial?.building?.subsection;
  const [sectorId, setSectorId] = useState<number | null>(sub?.sector?.id ?? null);
  const [subsectionId, setSubsectionId] = useState<number | null>(sub?.id ?? null);
  const [buildingText, setBuildingText] = useState(initial?.building?.number ?? '');
  const [apartment, setApartment] = useState(initial?.apartment ?? '');
  const [label, setLabel] = useState<string | null>(initial?.label ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const defaultLocked = isFirst || initial?.is_default === true;
  const [isDefault, setIsDefault] = useState(defaultLocked);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sectors = useSectors();
  const subsections = useSubsections(sectorId);
  const buildings = useBuildings(subsectionId);
  const buildingIndex = useMemo(() => indexBuildings(buildings.data ?? []), [buildings.data]);

  const sector = sectors.data?.find((s) => s.id === sectorId) ?? null;
  const unit = subsections.data?.find((s) => s.id === subsectionId) ?? null;
  const buildingNumber = normalizeBuildingInput(buildingText);
  const building = buildingNumber ? (buildingIndex.get(buildingNumber) ?? null) : null;
  const apartmentTrimmed = apartment.trim();
  const canSave = building !== null && apartmentTrimmed !== '' && session !== null && !busy;

  const loadError = sectors.error ?? subsections.error ?? buildings.error;

  function pickSector(id: number) {
    if (id === sectorId) return;
    setSectorId(id);
    setSubsectionId(null);
    setBuildingText('');
  }

  function pickUnit(id: number) {
    if (id === subsectionId) return;
    setSubsectionId(id);
    setBuildingText('');
  }

  async function save() {
    const client = getSupabase();
    if (!client || !session || !building || apartmentTrimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      building_id: building.id,
      apartment: apartmentTrimmed,
      note: note.trim() === '' ? null : note.trim(),
      label,
      is_default: isDefault,
    };
    try {
      let id: string;
      if (initial) {
        await updateAddress(client, session.user.id, initial.id, input);
        id = initial.id;
      } else {
        id = await createAddress(client, session.user.id, input);
        // العنوان الجديد يصير عنوان التوصيل الحالي (افتراض T12)
        selectAddress(id);
      }
      await invalidate();
      onSaved(id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const buildingStatus = (() => {
    if (subsectionId === null) return { text: ar.address.buildingPickUnit, tone: 'muted' } as const;
    if (buildingNumber === '' || buildings.isPending) {
      return { text: ar.address.buildingHint, tone: 'muted' } as const;
    }
    if (building) return null; // "موجودة" داخل الحقل
    return { text: ar.address.buildingNotFound, tone: 'danger' } as const;
  })();

  const preview = sector
    ? formatAddress({
        sector: sector.name,
        subsection: unit?.name ?? '',
        building: building ? building.number : '',
        apartment: apartmentTrimmed,
      })
    : '';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.address.back}
            onPress={onBack}
            style={styles.back}
            testID="address-back"
          >
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.flex}>
            <AppText accessibilityRole="header" weight="bold" size="title">
              {initial ? ar.address.editTitle : ar.address.newTitle}
            </AppText>
            {onboarding ? (
              <AppText size="caption" muted>
                {ar.address.onboardingStep}
              </AppText>
            ) : null}
          </View>
          {onboarding ? (
            <Pressable
              accessibilityRole="button"
              onPress={onBack}
              style={styles.later}
              testID="address-later"
            >
              <AppText size="small" weight="semibold" color={colors.primary}>
                {ar.address.later}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.main}
          keyboardShouldPersistTaps="handled"
        >
          {loadError ? <FormMessage text={ar.address.loadError} /> : null}

          <View style={styles.section}>
            <AppText weight="semibold" size="small">
              {ar.address.sector}
            </AppText>
            {sectors.isPending ? <ActivityIndicator color={colors.primary} /> : null}
            <View style={styles.row}>
              {(sectors.data ?? []).map((s) => (
                <Choice
                  key={s.id}
                  label={formatSector(s.name)}
                  selected={s.id === sectorId}
                  onPress={() => pickSector(s.id)}
                  style={styles.sectorButton}
                  testID={`sector-${s.id}`}
                />
              ))}
            </View>
          </View>

          {sectorId !== null ? (
            <View style={styles.section}>
              <AppText weight="semibold" size="small">
                {ar.address.unit}
              </AppText>
              {subsections.isPending ? <ActivityIndicator color={colors.primary} /> : null}
              <View style={styles.grid}>
                {(subsections.data ?? []).map((u) => (
                  <Choice
                    key={u.id}
                    label={u.name}
                    selected={u.id === subsectionId}
                    onPress={() => pickUnit(u.id)}
                    style={[styles.unitButton, { width: unitWidth }]}
                    small
                    testID={`unit-${u.id}`}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <AppText weight="semibold" size="small">
              {ar.address.building}
            </AppText>
            <View
              style={[
                styles.buildingBox,
                subsectionId === null && styles.disabledBox,
                buildingStatus?.tone === 'danger' && { borderColor: colors.danger },
              ]}
            >
              <Ionicons name="business-outline" size={20} color={colors.primary} />
              <TextInput
                testID="building-input"
                accessibilityLabel={ar.address.building}
                value={buildingText}
                onChangeText={(v) => setBuildingText(normalizeBuildingInput(v))}
                editable={subsectionId !== null}
                keyboardType="number-pad"
                maxLength={BUILDING_MAX_DIGITS}
                placeholder={ar.address.buildingPlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.buildingInput}
              />
              {building ? (
                <View style={styles.found} testID="building-found">
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                  <AppText size="small" weight="semibold" color={colors.primary}>
                    {ar.address.buildingFound}
                  </AppText>
                </View>
              ) : null}
            </View>
            {buildingStatus ? (
              <AppText
                size="small"
                color={buildingStatus.tone === 'danger' ? colors.danger : colors.textMuted}
                testID="building-status"
              >
                {buildingStatus.text}
              </AppText>
            ) : null}
          </View>

          <View style={styles.row}>
            <View style={[styles.section, styles.flex]}>
              <AppText weight="semibold" size="small">
                {ar.address.apartment}
              </AppText>
              <TextInput
                testID="apartment-input"
                accessibilityLabel={ar.address.apartment}
                value={apartment}
                onChangeText={setApartment}
                maxLength={APARTMENT_MAX}
                style={styles.input}
              />
            </View>
            <View style={[styles.section, styles.flex]}>
              <AppText weight="semibold" size="small">
                {ar.address.label}
              </AppText>
              <View style={styles.labels}>
                {ADDRESS_LABELS.map((l) => (
                  <Choice
                    key={l}
                    label={l}
                    selected={label === l}
                    soft
                    small
                    onPress={() => setLabel(label === l ? null : l)}
                    style={styles.flex}
                    testID={`label-${l}`}
                  />
                ))}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <AppText weight="semibold" size="small">
              {ar.address.note}{' '}
              <AppText size="small" muted>
                {ar.address.optional}
              </AppText>
            </AppText>
            <TextInput
              testID="note-input"
              accessibilityLabel={ar.address.note}
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX}
              placeholder={ar.address.notePlaceholder}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isDefault, disabled: defaultLocked }}
            disabled={defaultLocked}
            onPress={() => setIsDefault((v) => !v)}
            style={styles.checkRow}
            testID="default-toggle"
          >
            <Ionicons
              name={isDefault ? 'checkbox' : 'square-outline'}
              size={24}
              color={defaultLocked ? colors.textMuted : colors.primary}
            />
            <AppText>{ar.address.makeDefault}</AppText>
          </Pressable>

          {error ? <FormMessage text={error} /> : null}
        </ScrollView>

        <View style={styles.footer}>
          {preview ? (
            <AppText size="small" muted style={styles.center} testID="address-preview">
              {preview}
            </AppText>
          ) : null}
          <PrimaryButton
            title={ar.address.save}
            onPress={() => void save()}
            disabled={!canSave}
            loading={busy}
            testID="address-save"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Choice({
  label,
  selected,
  onPress,
  style,
  small = false,
  soft = false,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  /** اختيار ثانوي (التسمية): خلفية فاتحة بدل الأخضر الكامل */
  soft?: boolean;
  testID?: string;
}) {
  const selectedStyle = soft ? styles.choiceSoft : styles.choiceSelected;
  const textColor = selected ? (soft ? colors.primary : colors.surface) : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, small && styles.choiceSmall, selected && selectedStyle, style]}
      testID={testID}
    >
      <AppText
        weight={selected ? 'bold' : 'medium'}
        size={small ? 'small' : 'body'}
        color={textColor}
        style={styles.center}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  later: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  main: { padding: spacing.screen, paddingTop: spacing.xs, gap: 18 },
  section: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  labels: { flexDirection: 'row', gap: 6 },
  choice: {
    minHeight: 52,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  choiceSmall: { minHeight: sizes.touchTarget, borderRadius: radius.control },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceSoft: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  sectorButton: { flex: 1 },
  unitButton: { flexGrow: 0 },
  buildingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  disabledBox: { borderColor: colors.border, borderWidth: 1, opacity: 0.6 },
  buildingInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.title,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  found: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTarget,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg + 8,
    gap: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  center: { textAlign: 'center' },
});
