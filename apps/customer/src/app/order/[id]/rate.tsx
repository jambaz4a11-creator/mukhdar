// تقييم الطلب (T14، SPEC-customer §2.8، تصميم Rate): 1..5 نجوم + تعليق اختياري (500 حرف) ← rate_order.
// مرة واحدة وبعد التسليم فقط: rate_order يفرض ذلك (ORDER_NOT_RATEABLE / ALREADY_RATED)، والشاشة تعرض الحالة
// من الطلب المحمّل قبل الإرسال. يُفتح من الطلب أو من إشعار التسليم.
import Ionicons from '@expo/vector-icons/Ionicons';
import { parseBackendError } from '@mukhdar/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../../components/AppText';
import { FormMessage } from '../../../components/AuthFields';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { useRequireAuth } from '../../../features/auth/useRequireAuth';
import { orderKeys, RATING_COMMENT_MAX, rateOrder } from '../../../features/orders/api';
import { useOrder } from '../../../features/orders/hooks';
import { ar } from '../../../i18n/ar';
import { getSupabase } from '../../../lib/supabase';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../../../theme';
import { OfflineState } from '../../../components/OfflineState';
import { isFirstLoad, isOfflineEmpty } from '../../../lib/network';

const STARS = [1, 2, 3, 4, 5] as const;

export default function RateScreen() {
  const session = useRequireAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(session ? id : undefined);
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!session) return null;

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/order/[id]', params: { id } });
  }

  async function submit() {
    const client = getSupabase();
    if (!client || !id) return;
    if (stars < 1) {
      setError(ar.rate.pickStars);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await rateOrder(client, id, stars, comment);
      setDone(true);
    } catch (e) {
      const parsed = parseBackendError(e);
      if (parsed.code === 'ALREADY_RATED') setDone(true);
      else setError(parsed.code ? parsed.message : ar.rate.failed);
    }
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    setSending(false);
  }

  const data = order.data;
  const blocked = data
    ? data.rating
      ? ar.rate.already
      : data.status !== 'delivered'
        ? ar.rate.notDelivered
        : null
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.rate.close}
            onPress={close}
            style={styles.close}
            testID="rate-close"
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.main}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.icon}>
            <Ionicons name="checkmark" size={40} color={colors.primary} />
          </View>
          <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
            {data ? ar.rate.title(data.order_number) : ar.order.titleNoNumber}
          </AppText>

          {isFirstLoad(order) ? (
            <ActivityIndicator color={colors.primary} />
          ) : isOfflineEmpty(order) ? (
            <OfflineState />
          ) : done ? (
            <AppText weight="semibold" color={colors.primary} testID="rate-thanks">
              {ar.rate.thanks}
            </AppText>
          ) : blocked ? (
            <AppText muted style={styles.center} testID="rate-blocked">
              {blocked}
            </AppText>
          ) : (
            <>
              <AppText muted style={styles.center}>
                {ar.rate.subtitle}
              </AppText>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={ar.rate.starsA11y}
                style={styles.stars}
              >
                {STARS.map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="radio"
                    accessibilityLabel={ar.rate.starA11y(n)}
                    accessibilityState={{ checked: n === stars }}
                    onPress={() => {
                      setStars(n);
                      setError(null);
                    }}
                    style={styles.star}
                    testID={`rate-star-${n}`}
                  >
                    <Ionicons
                      name={n <= stars ? 'star' : 'star-outline'}
                      size={40}
                      color={n <= stars ? colors.star : colors.textMuted}
                    />
                  </Pressable>
                ))}
              </View>
              <AppText weight="semibold" color={colors.primary} style={styles.caption}>
                {ar.rate.captions[stars] ?? ''}
              </AppText>

              <View style={styles.field}>
                <AppText weight="semibold" size="small">
                  {ar.rate.comment}{' '}
                  <AppText size="small" muted>
                    {ar.address.optional}
                  </AppText>
                </AppText>
                <TextInput
                  testID="rate-comment"
                  accessibilityLabel={ar.rate.comment}
                  value={comment}
                  onChangeText={setComment}
                  maxLength={RATING_COMMENT_MAX}
                  multiline
                  numberOfLines={4}
                  placeholder={ar.rate.commentPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
                <AppText size="caption" muted style={styles.counter}>
                  {`${comment.length}/${RATING_COMMENT_MAX}`}
                </AppText>
              </View>
              {error ? <FormMessage text={error} /> : null}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {done || blocked ? (
            <PrimaryButton title={ar.orders.ok} onPress={close} testID="rate-done" />
          ) : (
            <>
              <PrimaryButton
                title={ar.rate.submit}
                onPress={() => void submit()}
                disabled={!data || stars < 1}
                loading={sending}
                testID="rate-submit"
              />
              <Pressable accessibilityRole="button" onPress={close} style={styles.later}>
                <AppText size="small" muted>
                  {ar.rate.later}
                </AppText>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.lg },
  close: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { alignItems: 'center', gap: 18, paddingHorizontal: 24, paddingBottom: spacing.lg },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  // النجوم من اليسار لليمين (1 ← 5) مثل التصميم، حتى بواجهة RTL
  stars: { flexDirection: 'row', direction: 'ltr', gap: 6 },
  star: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  caption: { minHeight: 24 },
  field: { alignSelf: 'stretch', gap: spacing.xs },
  input: {
    minHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.text,
    textAlign: 'right',
    textAlignVertical: 'top',
    writingDirection: 'rtl',
  },
  counter: { alignSelf: 'flex-end' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.screen,
    gap: spacing.xs,
  },
  later: { minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
