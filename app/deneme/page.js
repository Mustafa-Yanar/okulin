import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DenemeApp from './DenemeApp';

export const dynamic = 'force-dynamic';

export default async function DenemePage() {
  const session = await getSession();
  if (!session) redirect('/');

  // Sadece güvenli alanları client'a geçir
  const safe = {
    role: session.role,
    id: session.id || null,
    name: session.name || '',
  };
  return <DenemeApp session={safe} />;
}
