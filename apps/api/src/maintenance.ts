/** 移行中のみ配備する Worker。R2・決済・収集の実装を読み込まない。 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/health') {
      return Response.json({ status: 'maintenance', writesStopped: true });
    }
    return Response.json(
      { reason: 'メインネット移行のため一時停止中です。' },
      { status: 503, headers: { 'Retry-After': '900' } },
    );
  },
  async scheduled(): Promise<void> {},
};
