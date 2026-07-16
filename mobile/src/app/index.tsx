import { Redirect } from 'expo-router';
import { useSession } from '../store/session';
import { LoadingScreen } from '../ui/kit';

// Duruma göre yönlendirici — ekranlar arası akışın tek karar noktası.
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'needs-org') return <Redirect href="/kurum" />;
  if (status === 'needs-login') return <Redirect href="/giris" />;
  return <Redirect href="/bugun" />;
}
