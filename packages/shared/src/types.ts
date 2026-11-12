// أنواع مختصرة فوق database.types.ts (المولّد بـ `supabase gen types`، لا يُعدَّل يدوياً).
import type { Database } from './database.types';

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
export type RpcArgs<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Args'];
export type RpcReturns<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Returns'];

export type OrderStatus = Enums<'order_status'>;
export type UserRole = Enums<'user_role'>;
export type MovementType = Enums<'movement_type'>;
export type PushPlatform = Enums<'push_platform'>;
export type PushProvider = Enums<'push_provider'>;

export type Profile = Tables<'profiles'>;
export type AppSettings = Tables<'app_settings'>;
export type Sector = Tables<'sectors'>;
export type Subsection = Tables<'subsections'>;
export type Building = Tables<'buildings'>;
export type Address = Tables<'addresses'>;
export type Category = Tables<'categories'>;
export type Product = Tables<'products'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type OrderStatusHistory = Tables<'order_status_history'>;
export type Rating = Tables<'ratings'>;

/** نسخة العنوان المحفوظة مع الطلب (orders.address_snapshot). */
export interface AddressSnapshot {
  address_id: string;
  sector: string;
  subsection: string;
  building: string;
  apartment: string;
  note: string | null;
}

/** بند سلة كما يُرسل لـ place_order. لا سعر: الأسعار تُقرأ داخل قاعدة البيانات. */
export interface CartLine {
  product_id: string;
  qty: number;
}

/** ما ترجعه place_order. */
export interface PlaceOrderResult {
  order_id: string;
  order_number: number;
  total_iqd: number;
  status: OrderStatus;
  replayed: boolean;
}

export type { Database, Json } from './database.types';
