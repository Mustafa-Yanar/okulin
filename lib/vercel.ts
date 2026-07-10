// Vercel REST API — yeni kurum subdomain'ini ('<slug>.okulin.com') projeye otomatik
// ekler (onboarding otomasyonu). Eskiden elle `vercel domains add` çalıştırmak
// gerekiyordu; süper-admin panelinden kurum açınca bu adım otomatik yapılır.
//
// NEDEN GEREKLİ: Cloudflare NS yüzünden wildcard SSL (*.okulin.com) üretilemiyor.
// Cloudflare `*` A kaydı trafiği Vercel'e yönlendirir AMA Vercel her subdomain için
// ayrı SSL sertifikası üretsin diye domain projeye AÇIKÇA eklenmeli. Apex okulin.com
// zaten projede doğrulanmış olduğundan subdomain `verified:true` döner ve sertifika
// otomatik (HTTP-01) üretilir (~30sn).
//
// Env (Vercel Production — yoksa sessizce no-op, akış kırılmaz):
//   VERCEL_TOKEN       — API token (Account Settings → Tokens), team kapsamlı
//   VERCEL_PROJECT_ID  — prj_... (.vercel/project.json)
//   VERCEL_TEAM_ID     — team_... (.vercel/project.json orgId)

const API = 'https://api.vercel.com';

function vercelEnv() {
  return {
    token: process.env.VERCEL_TOKEN,
    projectId: process.env.VERCEL_PROJECT_ID,
    teamId: process.env.VERCEL_TEAM_ID || '',
  };
}

// Token + proje tanımlı mı? (panel "domain otomasyonu açık mı" göstergesi için)
export function vercelConfigured(): boolean {
  const { token, projectId } = vercelEnv();
  return Boolean(token && projectId);
}

export interface AddDomainResult {
  ok: boolean;
  domain?: string;
  verified?: boolean;
  alreadyExists?: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

// Subdomain'i projeye ekle. Hata FIRLATMAZ — sonuç nesnesi döner:
//   { ok:true, verified }            → eklendi
//   { ok:true, alreadyExists:true }  → zaten ekli (idempotent, 409)
//   { ok:false, skipped:true }       → env tanımsız (no-op)
//   { ok:false, status, error }      → API hatası
export async function addProjectDomain(domain: string): Promise<AddDomainResult> {
  const { token, projectId, teamId } = vercelEnv();
  if (!token || !projectId) {
    console.warn('[vercel] VERCEL_TOKEN/PROJECT_ID tanımsız — domain ekleme atlandı.');
    return { ok: false, skipped: true, error: 'Vercel domain otomasyonu yapılandırılmamış' };
  }
  if (!domain || typeof domain !== 'string') {
    return { ok: false, error: 'Geçersiz domain' };
  }

  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  try {
    const res = await fetch(`${API}/v10/projects/${encodeURIComponent(projectId)}/domains${qs}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, verified: data.verified !== false, domain };
    }
    // 409 = bu domain zaten projede ekli → onboarding açısından başarı say (idempotent).
    if (res.status === 409) {
      return { ok: true, alreadyExists: true, domain };
    }
    const errText = await res.text().catch(() => '');
    console.error(`[vercel] domain ekleme hatası (${res.status}):`, errText);
    return { ok: false, status: res.status, error: errText || `HTTP ${res.status}` };
  } catch (e) {
    console.error('[vercel] beklenmeyen hata:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
