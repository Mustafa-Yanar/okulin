import { Redis } from '@upstash/redis';

const redis = new Redis({
  // Env eksikse davranış eskisiyle aynı kalsın diye (ilk komutta hata) bilinçli
  // non-null cast — burada '' fallback'i client'ın hata mesajını değiştirirdi.
  url: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)!,
  token: (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)!,
});

export default redis;
