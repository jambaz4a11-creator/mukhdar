// عناويني (T12): قائمة بتعديل وحذف وتعيين افتراضي (افتراضي واحد لكل زبون).
// select=1 (من "التوصيل إلى" بالرئيسية): الضغط على العنوان يختاره للتوصيل ويرجع.
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorMessage, formatAddress, formatAddressShort } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { FormMessage } from '../../components/AuthFields';
import { PrimaryButton } from '../../components/PrimaryButton';
import {
  addressParts,
  type CustomerAddress,
  deleteAddress,
  pickDeliveryAddress,
  setDefaultAddress,
} from '../../features/addresses/api';
import { useInvalidateAddresses, useMyAddresses } from '../../features/addresses/hooks';
import { useSelectedAddress } from '../../features/addresses/selected';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

export default function AddressesScreen() {
  const session = useRequireAuth();
  const params = useLocalSearchParams<{ select?: string }>();
  const selecting = params.select === '1';
  const addresses = useMyAddresses();
  const invalidate = useInvalidateAddresses();
  const selectedId = useSelectedAddress((s) => s.selectedId);
  const select = useSelectedAddress((s) => s.select);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const list = addresses.data ?? [];
  const current = pickDeliveryAddress(list, selectedId);

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  function makeDefault(a: CustomerAddress) {
    const client = getSupabase();
    if (!client || !session) return;
    void run(a.id, () => setDefaultAddress(client, a.id));
  }

  function remove(a: CustomerAddress) {
    const client = getSupabase();
    if (!client || !session) return;
    const parts = addressParts(a);
    Alert.alert(ar.address.deleteTitle, parts ? formatAddress(parts) : undefined, [
      { text: ar.address.cancel, style: 'cancel' },
      {
        text: ar.address.deleteConfirm,
        style: 'destructive',
        onPress: () => {
          void run(a.id, async () => {
            await deleteAddress(client, a, list);
            if (selectedId === a.id) select(null);
          });
        },
      },
    ]);
  }

  function onCardPress(a: CustomerAddress) {
    if (selecting && addressParts(a)) {
      select(a.id);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } else {
      router.push({ pathname: '/address/[id]', params: { id: a.id } });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ar.address.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.back}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
        <AppText accessibilityRole="header" weight="bold" size="title">
          {selecting ? ar.address.selectTitle : ar.address.listTitle}
        </AppText>
      </View>

      <FlatList
        data={list}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={error ? <FormMessage text={error} /> : undefined}
        renderItem={({ item }) => (
          <AddressCard
            address={item}
            selecting={selecting}
            selected={selecting && current?.id === item.id}
            busy={busyId === item.id}
            onPress={() => onCardPress(item)}
            onEdit={() => router.push({ pathname: '/address/[id]', params: { id: item.id } })}
            onDelete={() => remove(item)}
            onMakeDefault={() => makeDefault(item)}
          />
        )}
        ListEmptyComponent={
          addresses.isPending && addresses.fetchStatus !== 'idle' ? (
            <ActivityIndicator color={colors.primary} style={styles.state} />
          ) : addresses.isError ? (
            <FormMessage text={errorMessage(addresses.error)} />
          ) : (
            <View style={styles.state} testID="addresses-empty">
              <AppText weight="semibold" style={styles.center}>
                {ar.address.empty}
              </AppText>
              <AppText muted size="small" style={styles.center}>
                {ar.address.emptyHint}
              </AppText>
            </View>
          )
        }
      />

      <View style={styles.footer}>
        <PrimaryButton
          title={ar.address.add}
          onPress={() => router.push('/address/new')}
          testID="address-add"
        />
      </View>
    </SafeAreaView>
  );
}

function AddressCard({
  address,
  selecting,
  selected,
  busy,
  onPress,
  onEdit,
  onDelete,
  onMakeDefault,
}: {
  address: CustomerAddress;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  const parts = addressParts(address);
  const title = address.label ?? (parts ? formatAddressShort(parts) : ar.address.listTitle);
  return (
    <View style={[styles.card, selected && styles.cardSelected]} testID={`address-${address.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={selecting ? { selected } : undefined}
        accessibilityLabel={parts ? formatAddress(parts) : ar.address.unavailable}
        onPress={onPress}
        style={styles.cardMain}
      >
        <Ionicons
          name={
            selecting ? (selected ? 'radio-button-on' : 'radio-button-off') : 'location-outline'
          }
          size={22}
          color={colors.primary}
        />
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <AppText weight="semibold">{title}</AppText>
            {address.is_default ? (
              <View style={styles.badge}>
                <AppText size="caption" weight="semibold" color={colors.primary}>
                  {ar.address.defaultBadge}
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText size="small" muted={parts !== null} color={parts ? undefined : colors.danger}>
            {parts ? formatAddress(parts) : ar.address.unavailable}
          </AppText>
          {address.note ? (
            <AppText size="caption" muted>
              {address.note}
            </AppText>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
      </Pressable>
      <View style={styles.actions}>
        {!address.is_default && parts ? (
          <Action label={ar.address.setDefault} onPress={onMakeDefault} disabled={busy} />
        ) : null}
        <Action label={ar.address.edit} onPress={onEdit} disabled={busy} />
        <Action label={ar.address.delete} onPress={onDelete} disabled={busy} danger />
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.action}
    >
      <AppText size="small" weight="semibold" color={danger ? colors.danger : colors.primary}>
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
  list: { padding: spacing.screen, gap: spacing.md, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  cardMain: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    alignItems: 'flex-start',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.xs,
  },
  action: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  state: { paddingVertical: 48, alignItems: 'center', gap: spacing.xs },
  center: { textAlign: 'center' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg + 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
