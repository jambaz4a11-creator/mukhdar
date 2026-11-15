// مراجعة NH6: صياغة واحدة لكل مفهوم (المسرد بـ ar.ts).
import { STATUS_LABELS } from '@mukhdar/shared';
import { ar } from '../i18n/ar';

describe('Arabic glossary', () => {
  it('pending reads "تم استلام الطلب" everywhere (badge, timeline, headline)', () => {
    expect(STATUS_LABELS.pending).toBe('تم استلام الطلب');
    expect(ar.order.steps.pending).toBe(STATUS_LABELS.pending);
    expect(ar.order.hero.pending).toBe(STATUS_LABELS.pending);
  });

  it('timeline step names are the shared status names', () => {
    for (const [status, label] of Object.entries(ar.order.steps)) {
      expect(label).toBe(STATUS_LABELS[status as keyof typeof STATUS_LABELS]);
    }
    expect(ar.order.cancelledStep).toBe(STATUS_LABELS.cancelled);
  });

  it('repeated concepts share one wording', () => {
    const g = ar.glossary;
    expect([ar.home.retry, ar.checkout.retry, ar.order.retry, ar.orders.retry]).toEqual(
      Array(4).fill(g.retry),
    );
    expect([ar.cart.browse, ar.orders.browse]).toEqual([g.browse, g.browse]);
    expect([ar.address.later, ar.rate.later, ar.notifications.later]).toEqual(
      Array(3).fill(g.later),
    );
    expect([ar.address.cancel, ar.account.deleteCancel]).toEqual([g.dismiss, g.dismiss]);
    expect([ar.order.rate, ar.orders.rate]).toEqual([g.rateOrder, g.rateOrder]);
    expect([ar.orders.reorder, ar.orders.reorderTitle]).toEqual([g.orderAgain, g.orderAgain]);
    expect(ar.offline.title).toBe(g.noInternet);
    expect(ar.offline.banner.startsWith(g.noInternet)).toBe(true);
  });
});
