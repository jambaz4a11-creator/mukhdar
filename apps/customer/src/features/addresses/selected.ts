// عنوان التوصيل المختار من الرئيسية (محفوظ على الجهاز). إن حُذف أو لم يُختر: الافتراضي (pickDeliveryAddress).
// T13 (تأكيد الطلب) يبدأ بنفس العنوان.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SelectedAddressState {
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const useSelectedAddress = create<SelectedAddressState>()(
  persist(
    (set) => ({
      selectedId: null,
      select: (id) => set({ selectedId: id }),
    }),
    {
      name: 'mukhdar.deliveryAddress',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ selectedId: s.selectedId }),
    },
  ),
);
