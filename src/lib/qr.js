/**
 * 地域防災力評価システム / QRコードの作成
 *
 * 置き場所： src/lib/qr.js
 *
 * 調査回ごとの回答URLをQRコードにして、
 *   ・画面に表示する
 *   ・PNG画像として保存する
 *   ・アンケート用紙に刷り込む
 * ために使います。
 *
 * QRコードの計算は qrcode-generator（MITライセンス・作者 Kazuhiko Arase 氏）に
 * 任せています。外部のサーバーに問い合わせないので、
 * 回答URLがよそへ送られることはありません。
 *
 * 「QRコード」は株式会社デンソーウェーブの登録商標です。
 */
import qrcode from "qrcode-generator";

/**
 * 文字列をQRコードの白黒マス目に変換する。
 * 戻り値の rows[行][列] が true のマスを黒く塗れば、QRコードになります。
 *
 * 誤り訂正レベルは M（約15%の汚れ・かすれまで読み取れる）を既定にしています。
 * 紙に印刷して屋外で使うことを考えた選択です。
 */
export function qrModules(text, ec = "M") {
  const qr = qrcode(0, ec);   // 0 = 文字数に合わせて大きさを自動で決める
  qr.addData(String(text ?? ""));
  qr.make();

  const count = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < count; r += 1) {
    const row = [];
    for (let c = 0; c < count; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return { count, rows };
}

/**
 * QRコードをPNG画像（データURL）にする。
 *
 * size は「だいたいこのくらいの大きさ」の目安です。
 * マス目がぼやけないよう、1マスを整数ピクセルに切りそろえるため、
 * 実際の大きさは指定より少し小さくなることがあります。
 */
export function qrDataUrl(text, { size = 640, margin = 4, ec = "M" } = {}) {
  const { count, rows } = qrModules(text, ec);

  /* margin は QRコードの規格で決められた余白（静穏帯）。4マス以上必要 */
  const cell = Math.max(1, Math.round(size / (count + margin * 2)));
  const px = cell * (count + margin * 2);

  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000000";

  rows.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    });
  });

  return canvas.toDataURL("image/png");
}

/** QRコードのPNG画像を、その場でダウンロードさせる */
export function downloadQrPng(text, filename = "QRコード.png", opts = {}) {
  const url = qrDataUrl(text, { size: 1200, ...opts });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** ファイル名に使えない文字を落とす */
export function safeFileName(s) {
  return String(s ?? "").replace(/[\\/:*?"<>|]/g, "_").trim() || "QRコード";
}
