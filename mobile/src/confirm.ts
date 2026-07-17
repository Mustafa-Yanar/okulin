import { Alert } from 'react-native';

// Kurumdan ayrılma onayı (Plan 3 Minor #7): oturum + push bağı + kayıtlı kurum
// silinir — yanlış dokunuş geri alınamaz olmasın. "Tüm cihazlardan çıkış" Alert'iyle
// tutarlı desen.
export function confirmLeaveOrg(onConfirm: () => void): void {
  Alert.alert('Kurumdan ayrıl', 'Oturumunuz kapatılacak ve kayıtlı kurum bu cihazdan silinecek.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Ayrıl', style: 'destructive', onPress: onConfirm },
  ]);
}
