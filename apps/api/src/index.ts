import { Hono } from 'hono';

import { SCHEMA_VERSION } from '@openbook/shared';

const app = new Hono();

/**
 * 稼働確認用のエンドポイント。
 * デプロイ後の疎通確認と、レコード形式のバージョン確認に用いる。
 */
app.get('/health', (c) => c.json({ status: 'ok', schemaVersion: SCHEMA_VERSION }));

export default app;
