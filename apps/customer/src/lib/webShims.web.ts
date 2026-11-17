// تعديلات خاصة بالويب (PWA). يُستورد مرة من الجذر.
// react-native-web: Alert.alert لا يفعل شيئاً، فتختفي كل نوافذ التأكيد (حذف عنوان/حساب، إلغاء طلب).
// نعوّضه بـ window.alert / window.confirm: زر الإلغاء = style 'cancel'، والتأكيد = آخر زر غير إلغاء.
import { Alert, type AlertButton } from 'react-native';

export function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const text = message ? `${title}\n\n${message}` : title;
  const actions = buttons ?? [];
  if (actions.length < 2) {
    window.alert(text);
    actions[0]?.onPress?.();
    return;
  }
  const cancel = actions.find((b) => b.style === 'cancel');
  const confirm = [...actions].reverse().find((b) => b !== cancel) ?? actions[actions.length - 1];
  if (window.confirm(text)) confirm?.onPress?.();
  else cancel?.onPress?.();
}

Alert.alert = webAlert;
