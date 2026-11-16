export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      addresses: {
        Row: {
          apartment: string;
          building_id: number;
          created_at: string;
          customer_id: string;
          id: string;
          is_default: boolean;
          label: string | null;
          note: string | null;
        };
        ComputedFields: never;
        Insert: {
          apartment: string;
          building_id: number;
          created_at?: string;
          customer_id: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          note?: string | null;
        };
        Update: {
          apartment?: string;
          building_id?: number;
          created_at?: string;
          customer_id?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'addresses_building_id_fkey';
            columns: ['building_id'];
            isOneToOne: false;
            referencedRelation: 'buildings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'addresses_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_audit: {
        Row: {
          action: string;
          actor: string | null;
          after: NonNullable<Json>;
          before: NonNullable<Json>;
          created_at: string;
          id: number;
          target_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor?: string | null;
          after?: NonNullable<Json>;
          before?: NonNullable<Json>;
          created_at?: string;
          id?: never;
          target_id?: string | null;
        };
        Update: {
          action?: string;
          actor?: string | null;
          after?: NonNullable<Json>;
          before?: NonNullable<Json>;
          created_at?: string;
          id?: never;
          target_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_audit_actor_fkey';
            columns: ['actor'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      app_settings: {
        Row: {
          closed_message: string | null;
          delivery_fee_iqd: number;
          id: number;
          max_active_orders: number;
          min_order_iqd: number;
          store_open: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          closed_message?: string | null;
          delivery_fee_iqd?: number;
          id?: number;
          max_active_orders?: number;
          min_order_iqd?: number;
          store_open?: boolean;
          updated_at?: string;
        };
        Update: {
          closed_message?: string | null;
          delivery_fee_iqd?: number;
          id?: number;
          max_active_orders?: number;
          min_order_iqd?: number;
          store_open?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      buildings: {
        Row: {
          id: number;
          is_active: boolean;
          number: string;
          sort_order: number;
          subsection_id: number;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          is_active?: boolean;
          number: string;
          sort_order?: number;
          subsection_id: number;
        };
        Update: {
          id?: never;
          is_active?: boolean;
          number?: string;
          sort_order?: number;
          subsection_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'buildings_subsection_id_fkey';
            columns: ['subsection_id'];
            isOneToOne: false;
            referencedRelation: 'subsections';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          id: number;
          image_path: string | null;
          is_active: boolean;
          name: string;
          sort_order: number;
          vendor_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          image_path?: string | null;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          vendor_id?: string | null;
        };
        Update: {
          id?: never;
          image_path?: string | null;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_vendor_id_fkey';
            columns: ['vendor_id'];
            isOneToOne: false;
            referencedRelation: 'vendors';
            referencedColumns: ['id'];
          },
        ];
      };
      cities: {
        Row: {
          id: number;
          is_active: boolean;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          is_active?: boolean;
          name: string;
        };
        Update: {
          id?: never;
          is_active?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      daily_stats: {
        Row: {
          adjust_loss_iqd: number;
          cancelled_count: number;
          cost_iqd: number;
          day: string;
          delivered_count: number;
          delivery_fees_iqd: number;
          gross_profit_iqd: number;
          net_profit_iqd: number | null;
          revenue_iqd: number;
          updated_at: string;
          waste_cost_iqd: number;
        };
        ComputedFields: never;
        Insert: {
          adjust_loss_iqd?: number;
          cancelled_count?: number;
          cost_iqd?: number;
          day: string;
          delivered_count?: number;
          delivery_fees_iqd?: number;
          gross_profit_iqd?: number;
          net_profit_iqd?: never;
          revenue_iqd?: number;
          updated_at?: string;
          waste_cost_iqd?: number;
        };
        Update: {
          adjust_loss_iqd?: number;
          cancelled_count?: number;
          cost_iqd?: number;
          day?: string;
          delivered_count?: number;
          delivery_fees_iqd?: number;
          gross_profit_iqd?: number;
          net_profit_iqd?: never;
          revenue_iqd?: number;
          updated_at?: string;
          waste_cost_iqd?: number;
        };
        Relationships: [];
      };
      inventory_movements: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: number;
          note: string | null;
          order_id: string | null;
          product_id: string;
          qty: number;
          type: Database['public']['Enums']['movement_type'];
          unit_cost_iqd: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          note?: string | null;
          order_id?: string | null;
          product_id: string;
          qty: number;
          type: Database['public']['Enums']['movement_type'];
          unit_cost_iqd: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          note?: string | null;
          order_id?: string | null;
          product_id?: string;
          qty?: number;
          type?: Database['public']['Enums']['movement_type'];
          unit_cost_iqd?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_movements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_movements_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          audience: string;
          body: string;
          claimed_at: string | null;
          created_at: string;
          data: NonNullable<Json>;
          id: number;
          last_error: string | null;
          sent_at: string | null;
          title: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          audience: string;
          body: string;
          claimed_at?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: never;
          last_error?: string | null;
          sent_at?: string | null;
          title: string;
          user_id?: string | null;
        };
        Update: {
          attempts?: number;
          audience?: string;
          body?: string;
          claimed_at?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: never;
          last_error?: string | null;
          sent_at?: string | null;
          title?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_outbox_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      order_item_costs: {
        Row: {
          cost_snapshot_iqd: number;
          order_item_id: number;
        };
        ComputedFields: never;
        Insert: {
          cost_snapshot_iqd: number;
          order_item_id: number;
        };
        Update: {
          cost_snapshot_iqd?: number;
          order_item_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'order_item_costs_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: true;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
        ];
      };
      order_items: {
        Row: {
          id: number;
          line_total_iqd: number;
          name_snapshot: string;
          order_id: string;
          price_snapshot_iqd: number;
          product_id: string | null;
          qty: number;
          unit_snapshot: string;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          line_total_iqd: number;
          name_snapshot: string;
          order_id: string;
          price_snapshot_iqd: number;
          product_id?: string | null;
          qty: number;
          unit_snapshot: string;
        };
        Update: {
          id?: never;
          line_total_iqd?: number;
          name_snapshot?: string;
          order_id?: string;
          price_snapshot_iqd?: number;
          product_id?: string | null;
          qty?: number;
          unit_snapshot?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      order_status_history: {
        Row: {
          changed_by: string | null;
          created_at: string;
          from_status: Database['public']['Enums']['order_status'] | null;
          id: number;
          note: string | null;
          order_id: string;
          to_status: Database['public']['Enums']['order_status'];
        };
        ComputedFields: never;
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['order_status'] | null;
          id?: never;
          note?: string | null;
          order_id: string;
          to_status: Database['public']['Enums']['order_status'];
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          from_status?: Database['public']['Enums']['order_status'] | null;
          id?: never;
          note?: string | null;
          order_id?: string;
          to_status?: Database['public']['Enums']['order_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'order_status_history_changed_by_fkey';
            columns: ['changed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_status_history_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          address_id: string | null;
          address_snapshot: NonNullable<Json>;
          assigned_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          city_id: number | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          delivery_fee_iqd: number;
          driver_id: string | null;
          id: string;
          idempotency_key: string;
          note: string | null;
          order_number: number;
          out_for_delivery_at: string | null;
          preparing_at: string | null;
          ready_at: string | null;
          status: Database['public']['Enums']['order_status'];
          subtotal_iqd: number;
          total_iqd: number;
          vendor_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          address_id?: string | null;
          address_snapshot: NonNullable<Json>;
          assigned_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          city_id?: number | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          delivered_at?: string | null;
          delivery_fee_iqd: number;
          driver_id?: string | null;
          id?: string;
          idempotency_key: string;
          note?: string | null;
          order_number?: never;
          out_for_delivery_at?: string | null;
          preparing_at?: string | null;
          ready_at?: string | null;
          status?: Database['public']['Enums']['order_status'];
          subtotal_iqd: number;
          total_iqd: number;
          vendor_id?: string | null;
        };
        Update: {
          address_id?: string | null;
          address_snapshot?: NonNullable<Json>;
          assigned_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          city_id?: number | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          delivered_at?: string | null;
          delivery_fee_iqd?: number;
          driver_id?: string | null;
          id?: string;
          idempotency_key?: string;
          note?: string | null;
          order_number?: never;
          out_for_delivery_at?: string | null;
          preparing_at?: string | null;
          ready_at?: string | null;
          status?: Database['public']['Enums']['order_status'];
          subtotal_iqd?: number;
          total_iqd?: number;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_address_id_fkey';
            columns: ['address_id'];
            isOneToOne: false;
            referencedRelation: 'addresses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'cities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_driver_id_fkey';
            columns: ['driver_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_vendor_id_fkey';
            columns: ['vendor_id'];
            isOneToOne: false;
            referencedRelation: 'vendors';
            referencedColumns: ['id'];
          },
        ];
      };
      pin_resets: {
        Row: {
          created_at: string;
          id: number;
          reset_by: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          reset_by?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: never;
          reset_by?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pin_resets_reset_by_fkey';
            columns: ['reset_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pin_resets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      product_costs: {
        Row: {
          cost_iqd: number;
          product_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cost_iqd: number;
          product_id: string;
          updated_at?: string;
        };
        Update: {
          cost_iqd?: number;
          product_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_costs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          category_id: number;
          city_id: number | null;
          created_at: string;
          description: string | null;
          id: string;
          image_path: string | null;
          in_stock: boolean;
          is_active: boolean;
          kind: string;
          name: string;
          price_iqd: number;
          sort_order: number;
          unit: string;
          updated_at: string;
          vendor_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          category_id: number;
          city_id?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          in_stock?: boolean;
          is_active?: boolean;
          kind?: string;
          name: string;
          price_iqd: number;
          sort_order?: number;
          unit: string;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          category_id?: number;
          city_id?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          in_stock?: boolean;
          is_active?: boolean;
          kind?: string;
          name?: string;
          price_iqd?: number;
          sort_order?: number;
          unit?: string;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'cities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_vendor_id_fkey';
            columns: ['vendor_id'];
            isOneToOne: false;
            referencedRelation: 'vendors';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          must_change_pin: boolean;
          phone: string | null;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          must_change_pin?: boolean;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          must_change_pin?: boolean;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          created_at: string;
          id: number;
          last_seen_at: string;
          platform: Database['public']['Enums']['push_platform'];
          provider: Database['public']['Enums']['push_provider'];
          token: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          last_seen_at?: string;
          platform: Database['public']['Enums']['push_platform'];
          provider?: Database['public']['Enums']['push_provider'];
          token: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          last_seen_at?: string;
          platform?: Database['public']['Enums']['push_platform'];
          provider?: Database['public']['Enums']['push_provider'];
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      ratings: {
        Row: {
          comment: string | null;
          created_at: string;
          customer_id: string | null;
          order_id: string;
          stars: number;
        };
        ComputedFields: never;
        Insert: {
          comment?: string | null;
          created_at?: string;
          customer_id?: string | null;
          order_id: string;
          stars: number;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          customer_id?: string | null;
          order_id?: string;
          stars?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'ratings_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ratings_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: true;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      sectors: {
        Row: {
          city_id: number | null;
          id: number;
          is_active: boolean;
          name: string;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          city_id?: number | null;
          id?: never;
          is_active?: boolean;
          name: string;
          sort_order?: number;
        };
        Update: {
          city_id?: number | null;
          id?: never;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'sectors_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'cities';
            referencedColumns: ['id'];
          },
        ];
      };
      stock: {
        Row: {
          low_stock_threshold: number;
          product_id: string;
          qty: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          low_stock_threshold?: number;
          product_id: string;
          qty?: number;
          updated_at?: string;
        };
        Update: {
          low_stock_threshold?: number;
          product_id?: string;
          qty?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      subsections: {
        Row: {
          id: number;
          is_active: boolean;
          name: string;
          sector_id: number;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          is_active?: boolean;
          name: string;
          sector_id: number;
          sort_order?: number;
        };
        Update: {
          id?: never;
          is_active?: boolean;
          name?: string;
          sector_id?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'subsections_sector_id_fkey';
            columns: ['sector_id'];
            isOneToOne: false;
            referencedRelation: 'sectors';
            referencedColumns: ['id'];
          },
        ];
      };
      user_creations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: number;
          role: Database['public']['Enums']['user_role'];
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          role: Database['public']['Enums']['user_role'];
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          role?: Database['public']['Enums']['user_role'];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'user_creations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_creations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      vendors: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          kind: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind?: string;
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _bump_daily_stats: {
        Args: {
          p_cancelled: number;
          p_cost: number;
          p_day: string;
          p_delivered: number;
          p_fees: number;
          p_revenue: number;
        };
        Returns: undefined;
      };
      _notify: {
        Args: {
          p_audience: string;
          p_body: string;
          p_data?: Json;
          p_title: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      abort_account_deletion: {
        Args: { p_user_id: string; p_was_active: boolean };
        Returns: undefined;
      };
      accept_order: {
        Args: { p_order_id: string };
        Returns: {
          address_id: string | null;
          address_snapshot: NonNullable<Json>;
          assigned_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          city_id: number | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          delivery_fee_iqd: number;
          driver_id: string | null;
          id: string;
          idempotency_key: string;
          note: string | null;
          order_number: number;
          out_for_delivery_at: string | null;
          preparing_at: string | null;
          ready_at: string | null;
          status: Database['public']['Enums']['order_status'];
          subtotal_iqd: number;
          total_iqd: number;
          vendor_id: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'orders';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_buildings: { Args: { p_numbers: string[]; p_subsection_id: number }; Returns: number };
      adjust_stock: {
        Args: {
          p_note?: string;
          p_product_id: string;
          p_qty: number;
          p_type: Database['public']['Enums']['movement_type'];
          p_unit_cost_iqd?: number;
        };
        Returns: number;
      };
      adjust_stock_bulk: {
        Args: {
          p_items: Json;
          p_note?: string;
          p_type: Database['public']['Enums']['movement_type'];
        };
        Returns: number;
      };
      admin_actions_last_hour: { Args: { p_admin: string; p_kind: string }; Returns: number };
      admin_save_product: { Args: { p: Json }; Returns: string };
      assign_driver: {
        Args: { p_driver_id: string; p_order_id: string };
        Returns: {
          address_id: string | null;
          address_snapshot: NonNullable<Json>;
          assigned_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          city_id: number | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          delivery_fee_iqd: number;
          driver_id: string | null;
          id: string;
          idempotency_key: string;
          note: string | null;
          order_number: number;
          out_for_delivery_at: string | null;
          preparing_at: string | null;
          ready_at: string | null;
          status: Database['public']['Enums']['order_status'];
          subtotal_iqd: number;
          total_iqd: number;
          vendor_id: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'orders';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      available_orders: {
        Args: { p_limit?: number };
        Returns: {
          building: string;
          created_at: string;
          id: string;
          item_count: number;
          order_number: number;
          sector: string;
          status: Database['public']['Enums']['order_status'];
          subsection: string;
          total_iqd: number;
        }[];
      };
      baghdad_today: { Args: Record<PropertyKey, never>; Returns: string };
      begin_account_deletion: { Args: { p_user_id: string }; Returns: boolean };
      claim_push_notifications: {
        Args: { p_limit?: number };
        Returns: {
          attempts: number;
          body: string;
          data: Json;
          id: number;
          recipients: Json;
          title: string;
        }[];
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Enums']['user_role'];
      };
      finish_push_notifications: {
        Args: { p_dead_tokens?: string[]; p_results: Json };
        Returns: undefined;
      };
      finish_user_creation: {
        Args: {
          p_created_by: string;
          p_full_name: string;
          p_role: Database['public']['Enums']['user_role'];
          p_user_id: string;
        };
        Returns: undefined;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_staff_or_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      list_drivers: {
        Args: Record<PropertyKey, never>;
        Returns: {
          full_name: string;
          id: string;
          is_active: boolean;
          phone: string;
        }[];
      };
      place_order: {
        Args: { p_address_id: string; p_idempotency_key: string; p_items: Json; p_note?: string };
        Returns: Json;
      };
      push_dispatch_authorized: { Args: { p_secret: string }; Returns: boolean };
      rate_order: {
        Args: { p_comment?: string; p_order_id: string; p_stars: number };
        Returns: undefined;
      };
      recompute_daily_stats: { Args: { p_from: string; p_to: string }; Returns: number };
      record_pin_reset: { Args: { p_reset_by: string; p_user_id: string }; Returns: undefined };
      register_push_token: {
        Args: {
          p_platform: Database['public']['Enums']['push_platform'];
          p_provider?: Database['public']['Enums']['push_provider'];
          p_token: string;
        };
        Returns: undefined;
      };
      reorder_products: { Args: { p_ids: string[] }; Returns: undefined };
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number };
      round_iqd: { Args: { amount: number }; Returns: number };
      set_default_address: { Args: { p_address_id: string }; Returns: undefined };
      set_order_status: {
        Args: {
          p_order_id: string;
          p_reason?: string;
          p_return_stock?: boolean;
          p_status: Database['public']['Enums']['order_status'];
        };
        Returns: {
          address_id: string | null;
          address_snapshot: NonNullable<Json>;
          assigned_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          city_id: number | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          delivery_fee_iqd: number;
          driver_id: string | null;
          id: string;
          idempotency_key: string;
          note: string | null;
          order_number: number;
          out_for_delivery_at: string | null;
          preparing_at: string | null;
          ready_at: string | null;
          status: Database['public']['Enums']['order_status'];
          subtotal_iqd: number;
          total_iqd: number;
          vendor_id: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'orders';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_product_price: {
        Args: { p_price_iqd: number; p_product_id: string };
        Returns: undefined;
      };
      set_user_role: {
        Args: {
          p_is_active?: boolean;
          p_role: Database['public']['Enums']['user_role'];
          p_user_id: string;
        };
        Returns: undefined;
      };
      signup_rate_hit: { Args: { p_ip: string; p_phone: string }; Returns: boolean };
      stuck_notifications_count: { Args: Record<PropertyKey, never>; Returns: number };
      update_app_settings: {
        Args: { p: Json };
        Returns: {
          closed_message: string | null;
          delivery_fee_iqd: number;
          id: number;
          max_active_orders: number;
          min_order_iqd: number;
          store_open: boolean;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'app_settings';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      movement_type: 'purchase' | 'sale' | 'waste' | 'adjust' | 'cancel_return';
      order_status:
        'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
      push_platform: 'ios' | 'android';
      push_provider: 'expo' | 'fcm';
      user_role: 'customer' | 'driver' | 'staff' | 'admin';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      movement_type: ['purchase', 'sale', 'waste', 'adjust', 'cancel_return'],
      order_status: ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'],
      push_platform: ['ios', 'android'],
      push_provider: ['expo', 'fcm'],
      user_role: ['customer', 'driver', 'staff', 'admin'],
    },
  },
} as const;
