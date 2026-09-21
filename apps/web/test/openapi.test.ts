import { beforeAll, describe, expect, it } from 'vitest';

/**
 * OpenAPI ドキュメントの確認。
 *
 * 手書きのドキュメントは実装から独立しているため、エンドポイントの挙動を
 * 変えた際に更新を忘れうる。パスと状態コードの過不足という明白な乖離を
 * 検知するために、構造の存在だけを確かめる。応答のスキーマの内容そのものの
 * 正しさは機械的に保証せず、レビューに委ねる。
 * 詳細は specs/openapi-docs/spec.md と design.md の決定 4 を参照。
 *
 * 取得は `fetch` で行う。Vite は `public/` の中身を配信の起点へそのまま置くため、
 * 本番で配信されるのと同じ所在を、そのまま検証できる。
 */

/** OpenAPI ドキュメントの、検証に用いる部分。 */
interface OpenApiDocument {
  openapi?: string;
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
}

/** 利用者向けとして載せるエンドポイント。 */
const PUBLIC_PATHS = ['/v1/records', '/v1/records/{date}'];

/** 載せてはならない、運営者向けと稼働確認用のエンドポイント。 */
const EXCLUDED_PATHS = ['/health', '/admin/rerun'];

let document: OpenApiDocument;
let docsHtml: string;

beforeAll(async () => {
  const documentResponse = await fetch('/openapi.json');
  expect(documentResponse.ok, '/openapi.json を取得できません').toBe(true);
  // 配信物がない場合は画面の HTML が返るため、型で取り違えを検知する。
  expect(
    documentResponse.headers.get('content-type'),
    '/openapi.json が JSON として配信されていません',
  ).toMatch(/application\/json/);
  document = (await documentResponse.json()) as OpenApiDocument;

  const docsResponse = await fetch('/docs/index.html');
  expect(docsResponse.ok, '/docs/index.html を取得できません').toBe(true);
  docsHtml = await docsResponse.text();
});

describe('ドキュメントの対象範囲', () => {
  it('利用者向けエンドポイントが記載されている', () => {
    const paths = Object.keys(document.paths ?? {});

    for (const path of PUBLIC_PATHS) {
      expect(paths).toContain(path);
    }
  });

  it('運営者向けエンドポイントが除外されている', () => {
    const paths = Object.keys(document.paths ?? {});

    for (const path of EXCLUDED_PATHS) {
      expect(paths).not.toContain(path);
    }
  });
});

describe('決済プロトコルの意味論を複製しない', () => {
  it('402 応答のスキーマが記載されている', () => {
    const responses = document.paths?.['/v1/records/{date}']?.['get']?.responses;

    expect(responses?.['402']).toBeDefined();
  });

  it('取得できない場合の状態コードがそろっている', () => {
    const responses = document.paths?.['/v1/records/{date}']?.['get']?.responses ?? {};

    // docs/paid-api.md が定める状態コード。過不足があれば乖離している。
    for (const status of ['200', '400', '402', '404', '409']) {
      expect(Object.keys(responses)).toContain(status);
    }
  });
});

describe('ドキュメントの配信', () => {
  it('OpenAPI のバージョンが 3.1 系である', () => {
    expect(document.openapi).toMatch(/^3\.1\./);
  });
});

describe('閲覧用の画面', () => {
  it('配信中のドキュメントを読み込む', () => {
    // 内容を複製せず、配信中の /openapi.json を読み込むことで二重管理を避ける。
    expect(docsHtml).toContain('/openapi.json');
  });
});
