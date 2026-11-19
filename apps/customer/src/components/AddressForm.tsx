// نموذج العنوان (T12؛ نطاقات بسماية 2026-11-19): كلها قوائم اختيار بلا كتابة حرة:
// البلوك (قطاع + وحدة: A1..A9، B1..B3، B8 النشطة فقط) ← البناية (1..N لذلك البلوك) ← الطابق (G، 1..9)
// ← الشقة (1..12)، ثم تسمية قصيرة اختيارية، والملاحظة، والافتراضي. تغيير البلوك يمسح البناية.
// الشجرة بقاعدة البيانات كما هي (قطاع ← وحدة ← عمارة)؛ قاعدة البيانات ترفض أي قيمة خارج النطاق (FLOOR_INVALID...).
// عنوان قديم غير صالح (طابق ناقص/خارج G..9، شقة خارج 1..12): يُفتح بحقوله الناقصة فارغة ويُطلب تصحيحه.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  errorMessage,
  floorOptionLabel,
  formatAddress,
  formatSector,
  isValidApartment,
  isValidFloor,
} from '@mukhdar/shared';
import { type ReactNode, useMemo, useState } from 'react';
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
  addressNeedsFix,
  APARTMENT_OPTIONS,
  type BlockRow,
  createAddress,
  type CustomerAddress,
  FLOOR_OPTIONS,
  LABEL_MAX,
  NOTE_MAX,
  sortBuildings,
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
  // القائمة المفتوحة الآن (واحدة فقط)
  const [openField, setOpenField] = useState<Field | null>(null);
  const [buildingNumber, setBuildingNumber] = useState<string | null>(
    initial?.building?.number ?? null,
  );
  // عنوان قديم بطابق أو شقة غير صالحين: يبدأ الحقل فارغاً ليختار الزبون من القائمة
  const [floor, setFloor] = useState<number | null>(
    initial && isValidFloor(initial.floor) ? initial.floor : null,
  );
  const [apartment, setApartment] = useState<number | null>(
    initial && isValidApartment(initial.apartment) ? Number(initial.apartment.trim()) : null,
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const defaultLocked = isFirst || initial?.is_default === true;
  const [isDefault, setIsDefault] = useState(defaultLocked);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocks = useBlocks();
  const buildings = useBuildings(blockId);
  const buildingList = useMemo(() => sortBuildings(buildings.data ?? []), [buildings.data]);
  const groups = useMemo(() => groupBySector(blocks.data ?? []), [blocks.data]);

  const block = blocks.data?.find((b) => b.id === blockId) ?? null;
  // العمارة المختارة لازم تكون من قائمة البلوك الحالية (1..N)
  const building = buildingNumber
    ? (buildingList.find((b) => b.number === buildingNumber) ?? null)
    : null;
  const labelTrimmed = label.trim();
  const canSave =
    building !== null && floor !== null && apartment !== null && session !== null && !busy;
  const needsFixNotice = initial !== undefined && addressNeedsFix(initial);

  const loadError = blocks.error ?? buildings.error;

  const toggle = (field: Field) => setOpenField((cur) => (cur === field ? null : field));

  function pickBlock(id: number) {
    setOpenField(null);
    if (id === blockId) return;
    setBlockId(id);
    setBuildingNumber(null);
  }

  async function save() {
    const client = getSupabase();
    if (!client || !session || !building || floor === null || apartment === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      building_id: building.id,
      floor,
      apartment: String(apartment),
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

  const preview = block
    ? formatAddress({
        sector: block.sector.name,
        subsection: block.name,
        building: building ? building.number : '',
        floor,
        apartment: apartment === null ? '' : String(apartment),
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

          {needsFixNotice ? (
            <AppText size="small" color={colors.warningText} testID="address-fix-notice">
              {ar.address.fixOld}
            </AppText>
          ) : null}

          {/* 1. البلوك: قائمة منسدلة واحدة (القطاع + الوحدة)، النشطة فقط */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.block} />
            <SelectBox
              id="block"
              icon="grid-outline"
              open={openField === 'block'}
              onToggle={() => toggle('block')}
              valueText={block ? block.name : null}
              placeholder={ar.address.blockPlaceholder}
              a11y={ar.address.blockA11y(block?.name ?? null)}
              hint={block ? formatSector(block.sector.name) : undefined}
            >
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
                        style={styles.optionButton}
                        testID={`block-${b.id}`}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </SelectBox>
          </View>

          {/* 2. البناية: 1..N لبلوكها */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.building} />
            <SelectBox
              id="building"
              icon="business-outline"
              disabled={blockId === null}
              open={openField === 'building'}
              onToggle={() => toggle('building')}
              valueText={building ? building.number : null}
              placeholder={
                blockId === null ? ar.address.buildingPickBlock : ar.address.buildingPlaceholder
              }
              a11y={ar.address.building}
            >
              {buildings.isPending ? <ActivityIndicator color={colors.primary} /> : null}
              <View style={styles.grid}>
                {buildingList.map((b) => (
                  <Choice
                    key={b.id}
                    label={b.number}
                    selected={b.number === buildingNumber}
                    onPress={() => {
                      setBuildingNumber(b.number);
                      setOpenField(null);
                    }}
                    style={styles.optionButton}
                    testID={`building-${b.number}`}
                  />
                ))}
              </View>
            </SelectBox>
          </View>

          {/* 3. الطابق: G و1..9 */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.floor} />
            <SelectBox
              id="floor"
              icon="layers-outline"
              open={openField === 'floor'}
              onToggle={() => toggle('floor')}
              valueText={floor === null ? null : floorOptionLabel(floor)}
              placeholder={ar.address.floorPlaceholder}
              a11y={ar.address.floor}
            >
              <View style={styles.grid}>
                {FLOOR_OPTIONS.map((f) => (
                  <Choice
                    key={f}
                    label={floorOptionLabel(f)}
                    selected={f === floor}
                    onPress={() => {
                      setFloor(f);
                      setOpenField(null);
                    }}
                    style={styles.optionButton}
                    testID={`floor-${f}`}
                  />
                ))}
              </View>
            </SelectBox>
          </View>

          {/* 4. رقم الشقة: 1..12 */}
          <View style={styles.section}>
            <FieldTitle text={ar.address.apartment} />
            <SelectBox
              id="apartment"
              icon="home-outline"
              open={openField === 'apartment'}
              onToggle={() => toggle('apartment')}
              valueText={apartment === null ? null : String(apartment)}
              placeholder={ar.address.apartmentPlaceholder}
              a11y={ar.address.apartment}
            >
              <View style={styles.grid}>
                {APARTMENT_OPTIONS.map((n) => (
                  <Choice
                    key={n}
                    label={String(n)}
                    selected={n === apartment}
                    onPress={() => {
                      setApartment(n);
                      setOpenField(null);
                    }}
                    style={styles.optionButton}
                    testID={`apartment-${n}`}
                  />
                ))}
              </View>
            </SelectBox>
          </View>

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

type Field = 'block' | 'building' | 'floor' | 'apartment';

/** حقل اختيار منسدل: الصف المضغوط (testID `${id}-select`، القيمة `${id}-value`) ثم القائمة `${id}-list` عند الفتح. */
function SelectBox({
  id,
  icon,
  open,
  disabled = false,
  onToggle,
  valueText,
  placeholder,
  a11y,
  hint,
  children,
}: {
  id: Field;
  icon: keyof typeof Ionicons.glyphMap;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  valueText: string | null;
  placeholder: string;
  a11y: string;
  hint?: string;
  children: ReactNode;
}) {
  const isOpen = open && !disabled;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ expanded: isOpen, disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={[styles.select, disabled && styles.disabledBox, isOpen && styles.selectOpen]}
        testID={`${id}-select`}
      >
        <Ionicons name={icon} size={20} color={colors.primary} />
        <AppText
          weight={valueText ? 'semibold' : 'regular'}
          size={valueText ? 'title' : 'body'}
          color={valueText ? colors.text : colors.textMuted}
          style={styles.flex}
          testID={`${id}-value`}
        >
          {valueText ?? placeholder}
        </AppText>
        {hint ? (
          <AppText size="small" muted>
            {hint}
          </AppText>
        ) : null}
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textMuted}
        />
      </Pressable>
      {isOpen ? (
        <View style={styles.dropdown} testID={`${id}-list`}>
          {children}
        </View>
      ) : null}
    </View>
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
  optionButton: { minWidth: sizes.touchTarget, width: '22%', flexGrow: 0 },
  labelChip: { paddingHorizontal: spacing.md },
  disabledBox: { borderColor: colors.border, borderWidth: 1, opacity: 0.6 },
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
