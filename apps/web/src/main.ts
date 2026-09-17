import { mount } from './app.js';

/**
 * 画面の入口。
 *
 * 有料 API で何が取得できるかを確かめるための画面である。日次データの主たる
 * 取得経路は API そのものであり、この画面はその内容を確かめるためのものとする。
 * 詳細は specs/public-dashboard/spec.md を参照。
 */
const container = document.querySelector<HTMLElement>('#app');

if (container !== null) {
  void mount(container);
}
