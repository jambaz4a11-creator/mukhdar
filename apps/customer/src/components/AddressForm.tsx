// نموذج العنوان (T12؛ تصميم 2026-11-18 "مثل تطبيقات بسماية"): البلوك (قائمة منسدلة واحدة تجمع القطاع والوحدة:
// A1..A9، B1..B8) ← البناية (تُكتب ويُتحقق منها مقابل بنايات البلوك النشطة) ← الطابق (0 = الأرضي .. 20) ← رقم الشقة،
// ثم تسمية قصيرة اختيارية (مثلاً "البيت")، والملاحظة، والافتراضي. تغيير البلوك يمسح البناية.
// الشجرة بقاعدة البيانات كما هي (قطاع ← وحدة ← عمارة)؛ الطابق إلزامي لعنوان جديد (FLOOR_REQUIRED).
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
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ADDRESS_LABELS,
  APARTMENT_MAX,
  type BlockRow,
  BUILDING_MAX_DIGITS,
  createAddress,
  type CustomerAddress,
  indexBuildings,
  LABEL_MAX,
  normalizeBuildingInput,
  normalizeFloorInput,
  NOTE_MAX,
  parseFloor,
  updateAddress,
} from '../features/addresses/api';
import { useBlocks, useBuildings, useInvalidateAddresses } from '../features/addresses/hooks';
import { useSelectedAddress } from '../features/addresses/selected';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { getSupabase } from '../lib/supabase';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { FormMessage } from './AuthFields';
import { PrimaryButton } from './PrimaryButton';

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

/** البلوكات مجمّعة بالقطاع بترتيبها (للقائمة المنسدلة). */
function groupBySector(blocks: BlockRow[]): { sector: BlockRow['sector']; blocks: BlockRow[] }[] {
  const groups: { sector: BlockRow['sector']; blocks: BlockRow[] }[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (last && last.sector.id === b.sector.id) last.blocks.push(b);
    else groups.push({ sector: b.sector, blocks: [b] });
  }
  return groups;
}

export function AddressForm({ initial, isFirst, onboarding = false, onBack, onSaved }: Props) {
  const session = useAuth((s) => s.session);
  const invalidate = useInvalidateAddresses();
  const selectAddress = useSelectedAddress((s) => s.select);

  const [blockId, setBlockId] = useState<number | null>(initial?.building?.subsection?.id ?? null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [buildingText, setBuildingText] = useState(initial?.building?.number ?? '');
  const [floorText, setFloorText] = useState(
    initial?.floor === null || initial?.floor === undefined ? '' : String(initial.floor),
  );
  const [apartment, setApartment] = useState(initial?.apartment ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const defaultLocked = isFirst || initial?.is_default === true;
  const [isDefault, setIsDefault] = useState(defaultLocked);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocks = useBlocks();
  const buildings = useBuildings(blockId);
  const buildingIndex = useMemo(() => indexBuildings(buildings.data ?? []), [buildings.data]);
  const groups = useMemo(() => groupBySector(blocks.data ?? []), [blocks.data]);

  const block = blocks.data?.find((b) => b.id === blockId) ?? null;
  const buildingNumber = normalizeBuildingInput(buildingText);
  const building = buildingNumber ? (buildingIndex.get(buildingNumber) ?? null) : null;
  const floor = parseFloor(floorText);
  const floorInvalid = floorText !== '' && floor === null;
  const apartmentTrimmed = apartment.trim();
  const labelTrimmed = label.trim();
  const canSave =
    building !== null && floor !== null && apartmentTrimmed !== '' && session !== null && !busy;

  const loadError = blocks.error ?? buildings.error;

  function pickBlock(id: number) {
    setBlockOpen(false);
    if (id === blockId) return;
    setBlockId(id);
    setBuildingText('');
  }

  async function save() {
    const client = getSupabase();
    if (!client || !session || !building || floor === null || apartmentTrimmed === '' || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      building_id: building.id,
      floor,
      apartment: apartmentTrimmed,
      note: note.trim() === '' ? null : note.trim(),
      label: labelTrimmed === '' ? null : labelTrimmed,
      is_default: isDefault,
    };
    try {
      let id: string;
      if (initial) {
        await updateAddress(client, initial.id, input);
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
    if (blockId === null) return { text: ar.address.buildingPickBlock, tone: 'muted' } as const;
    if (buildingNumber === '' || buildings.isPending) {
      return { text: ar.address.buildingHint, tone: 'muted' } as const;
    }
    if (building) return null; // "موجودة" داخل الحقل
    return { text: ar.address.buildingNotFound, tone: 'danger' } as const;
  })();

  const floorStatus = floorInvalid
    ? ar.address.floorInvalid
    : initial && initial.floor === null && floorText === ''
      ? ar.address.floorMissingOld
      : null;

  const preview = block
    ? formatAddress({
        sector: block.sector.name,
        subsection: block.name,
        building: building ? building.number : '',
        floor,
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

          {/* 1. البلوك: قائمة منسدلة واحدة (القطاع + الوحدة) */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.block} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ar.address.blockA11y(block?.name ?? null)}
              accessibilityState={{ expanded: blockOpen }}
              onPress={() => setBlockOpen((v) => !v)}
              style={[styles.select, blockOpen && styles.selectOpen]}
              testID="block-select"
            >
              <Ionicons name="grid-outline" size={20} color={colors.primary} />
              <AppText
                weight={block ? 'semibold' : 'regular'}
                size={block ? 'title' : 'body'}
                color={block ? colors.text : colors.textMuted}
                style={styles.flex}
                testID="block-value"
              >
                {block ? block.name : ar.address.blockPlaceholder}
              </AppText>
              {block ? (
                <AppText size="small" muted>
                  {formatSector(block.sector.name)}
                </AppText>
              ) : null}
              <Ionicons
                name={blockOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
            {blockOpen ? (
              <View style={styles.dropdown} testID="block-list">
                {blocks.isPending ? <ActivityIndicator color={colors.primary} /> : null}
                {groups.map((g) => (
                  <View key={g.sector.id} style={styles.group}>
                    <AppText size="caption" weight="semibold" muted>
                      {formatSector(g.sector.name)}
                    </AppText>
                    <View style={styles.grid}>
                      {g.blocks.map((b) => (
                        <Choice
                          key={b.id}
                          label={b.name}
                          selected={b.id === blockId}
                          onPress={() => pickBlock(b.id)}
                          style={styles.blockButton}
                          testID={`block-${b.id}`}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* 2. البناية */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.building} />
            <View
              style={[
                styles.buildingBox,
                blockId === null && styles.disabledBox,
                buildingStatus?.tone === 'danger' && { borderColor: colors.danger },
              ]}
            >
              <Ionicons name="business-outline" size={20} color={colors.primary} />
              <TextInput
                testID="building-input"
                accessibilityLabel={ar.address.building}
                value={buildingText}
                onChangeText={(v) => setBuildingText(normalizeBuildingInput(v))}
                editable={blockId !== null}
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

          {/* 3. الطابق، 4. رقم الشقة */}
          <View style={styles.row}>
            <View style={[styles.section, styles.flex]}>
              <FieldTitle text={ar.address.floor} />
              <TextInput
                testID="floor-input"
                accessibilityLabel={ar.address.floor}
                value={floorText}
                onChangeText={(v) => setFloorText(normalizeFloorInput(v))}
                keyboardType="number-pad"
                maxLength={2}
                placeholder={ar.address.floorPlaceholder}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, floorInvalid && styles.inputDanger]}
              />
            </View>
            <View style={[styles.section, styles.flex]}>
              <FieldTitle text={ar.address.apartment} />
              <TextInput
                testID="apartment-input"
                accessibilityLabel={ar.address.apartment}
                value={apartment}
                onChangeText={setApartment}
                maxLength={APARTMENT_MAX}
                style={styles.input}
              />
            </View>
          </View>
          {floorStatus ? (
            <AppText
              size="small"
              color={floorInvalid ? colors.danger : colors.warningText}
              testID="floor-status"
            >
              {floorStatus}
            </AppText>
          ) : null}

          {/* تسمية قصيرة اختيارية */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.label} optional />
            <TextInput
              testID="label-input"
              accessibilityLabel={ar.address.label}
              value={label}
              onChangeText={setLabel}
              maxLength={LABEL_MAX}
              placeholder={ar.address.labelPlaceholder}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={styles.labels}>
              {ADDRESS_LABELS.map((l) => (
                <Choice
                  key={l}
                  label={l}
                  selected={labelTrimmed === l}
                  soft
                  small
                  onPress={() => setLabel(labelTrimmed === l ? '' : l)}
                  style={styles.labelChip}
                  testID={`label-${l}`}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <FieldTitle text={ar.address.note} optional />
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

function FieldTitle({ text, optional = false }: { text: string; optional?: boolean }) {
  return (
    <AppText weight="semibold" size="small">
      {text}
      {optional ? (
        <AppText size="small" muted>
          {` ${ar.address.optional}`}
        </AppText>
      ) : null}
    </AppText>
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
  group: { gap: 6 },
  labels: { flexDirection: 'row', gap: 6 },
  select: {
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
  selectOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  dropdown: {
    marginTop: -spacing.xs - 2,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: colors.primary,
    borderBottomLeftRadius: radius.input,
    borderBottomRightRadius: radius.input,
    backgroundColor: colors.surface,
  },
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
  // 4 بالسطر حتى على 360px (عرض القائمة ≈ 284: 4 × 22% + 3 فراغات = 274)، وكل زر ≥ 44
  blockButton: { minWidth: sizes.touchTarget, width: '22%', flexGrow: 0 },
  labelChip: { paddingHorizontal: spacing.md },
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
  inputDanger: { borderColor: colors.danger },
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
