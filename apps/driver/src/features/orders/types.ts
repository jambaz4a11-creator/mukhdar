// أنواع طلبات السائق (DRIVER-API §3.1 و§4). كل حقول لقطة العنوان عدا القطاع والوحدة اختيارية (زبون محذوف، عنوان قديم).
import type { OrderStatus } from '@mukhdar/shared';

/** صف `available_orders`: بلا اسم ولا هاتف ولا طابق ولا شقة قبل القبول (قصداً). */
export interface AvailableOrder {
  id: string;
  order_number: number;
  status: 'ready';
  sector: string;
  subsection: string;
  building: string;
  item_count: number;
  line_count: number;
  total_iqd: number;
  created_at: string;
}

export interface AddressSnapshotView {
  sector?: string | null;
  subsection?: string | null;
  building?: string | null;
  floor?: number | null;
  apartment?: string | null;
  note?: string | null;
}

/** صف طلب معيَّن لي (قائمة طلباتي). */
export interface MyOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  address_snapshot: AddressSnapshotView | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_iqd: number;
  note: string | null;
  created_at: string;
  assigned_at?: string | null;
}

export interface OrderItemView {
  name_snapshot: string;
  unit_snapshot: string;
  qty: number;
  price_snapshot_iqd: number;
  line_total_iqd: number;
}

export interface OrderDetail extends MyOrder {
  order_items: OrderItemView[];
}
