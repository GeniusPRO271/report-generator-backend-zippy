export const config = {
  redisUrl: process.env.REDIS_URL!,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL!,
};
