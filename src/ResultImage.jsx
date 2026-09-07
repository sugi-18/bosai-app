/**
 * 地域防災力評価システム / 回答結果を画像で保存
 *
 * 置き場所： src/ResultImage.jsx
 * BosaiSurvey.jsx の完了画面から呼び出して使います。
 *
 * スマートフォンでは印刷機能が使えないことが多く
 * （とくに LINE などのアプリ内ブラウザでは項目自体がありません）、
 * 「結果を印刷する」だけでは結果を手元に残せませんでした。
 *
 * そこで、結果を1枚の画像として描き起こし、
 * 保存できるようにしています。画像であれば、
 * どの端末でも長押しやダウンロードで写真として残せます。
 *
 * 地域平均は重ねていません。一斉に回答していただく場では、
 * 先に答えた方には平均が出ず、少人数のうちに出た平均も
 * 実態とかけ離れた値になるためです。
 */
import React, { useState, useRef } from "react";

const W = 900;
const H = 1280;
const GREEN = "#00703c";
const GREEN_D = "#004f2a";
const AMBER = "#e0a12c";
const INK = "#16211c";
const SUB = "#5b6b62";
const LINE = "#d3dbd5";

const r2 = (x) => Math.round(x * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** レーダーを1つ描く */
function drawRadar(ctx, cx, cy, R, items, mine, title) {
  const n = items.length;
  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (R * Math.max(0, Math.min(5, Number(v) || 0))) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText(title, cx, cy - R - 30);

  ctx.strokeStyle = "#e2e8e4";
  ctx.lineWidth = 1;
  [1, 2, 3, 4, 5].forEach((ring) => {
    ctx.beginPath();
    items.forEach((_, i) => {
      const [x, y] = point(i, ring);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  });
  items.forEach((_, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.stroke();
  });

  const shape = (vals, fill, stroke, width) => {
    ctx.beginPath();
    vals.forEach((v, i) => {
      const [x, y] = point(i, v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  shape(mine, "rgba(0,112,60,.28)", GREEN, 3);

  ctx.font = "13px sans-serif";
  ctx.fillStyle = SUB;
  items.forEach((it, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.fillText(String(it.item_no), cx + (R + 18) * Math.cos(a), cy + (R + 18) * Math.sin(a) + 5);
  });
}

/** 結果を1枚の画像として描く */
function render(canvas, { master, result, roundLabel, assocName, weak }) {
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  /* 見出し */
  ctx.fillStyle = GREEN_D;
  ctx.fillRect(0, 0, W, 108);
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, 108, W, 8);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("防災力アンケート　あなたの結果", 44, 60);
  ctx.font = "18px sans-serif";
  ctx.fillText([assocName, roundLabel].filter(Boolean).join("　"), 44, 92);

  /* 得点 */
  const kTotal = r2(sum(result.k));
  const sTotal = r2(sum(result.s));
  const total = r2(kTotal + sTotal);

  const box = (x, y, w, label, value, max) => {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 116);
    ctx.fillStyle = SUB;
    ctx.font = "16px sans-serif";
    ctx.fillText(label, x + 18, y + 32);
    ctx.fillStyle = INK;
    ctx.font = "bold 46px sans-serif";
    ctx.fillText(String(value.toFixed(1)), x + 18, y + 82);
    const tw = ctx.measureText(String(value.toFixed(1))).width;
    ctx.fillStyle = SUB;
    ctx.font = "18px sans-serif";
    ctx.fillText(`/${max}`, x + 24 + tw, y + 82);

    ctx.fillStyle = "#e2e8e4";
    ctx.fillRect(x + 18, y + 94, w - 36, 10);
    ctx.fillStyle = GREEN;
    ctx.fillRect(x + 18, y + 94, ((w - 36) * value) / max, 10);
  };

  const bw = (W - 88 - 24) / 3;
  box(44, 148, bw, "防災行動力", kTotal, 100);
  box(44 + bw + 12, 148, bw, "初動対応力", sTotal, 100);
  box(44 + (bw + 12) * 2, 148, bw, "総合得点", total, 200);

  /* レーダー */
  drawRadar(ctx, 260, 470, 130, master.koudou, result.k, "防災行動力");
  drawRadar(ctx, 640, 470, 130, master.shodou, result.s, "初動対応力");

  ctx.textAlign = "center";
  ctx.font = "15px sans-serif";
  ctx.fillStyle = GREEN;
  ctx.fillRect(330, 630, 16, 16);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText("あなた", 354, 644);
  ctx.fillStyle = SUB;
  ctx.font = "13px sans-serif";
  ctx.fillText("数字は設問番号／各5点満点", 330, 668);

  /* まず取り組みたいこと */
  ctx.fillStyle = GREEN;
  ctx.fillRect(44, 700, W - 88, 36);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 19px sans-serif";
  ctx.fillText("まず取り組みたいこと", 60, 725);

  let y = 766;
  if (weak.length === 0) {
    ctx.fillStyle = INK;
    ctx.font = "17px sans-serif";
    ctx.fillText("大きく不足している項目はありませんでした。", 48, y);
  } else {
    weak.slice(0, 5).forEach((wk, i) => {
      ctx.fillStyle = "#c1272d";
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(String(i + 1), 48, y);
      ctx.fillStyle = INK;
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(wk.label, 72, y);
      ctx.fillStyle = SUB;
      ctx.font = "15px sans-serif";

      /* 改善のヒントは長いので、幅に合わせて折り返す */
      const words = String(wk.improvement_tip ?? "").split("");
      let line = "";
      let ly = y + 24;
      words.forEach((ch) => {
        const t = line + ch;
        if (ctx.measureText(t).width > W - 140) {
          ctx.fillText(line, 72, ly);
          ly += 21;
          line = ch;
        } else { line = t; }
      });
      if (line) ctx.fillText(line, 72, ly);
      y = ly + 44;
    });
  }

  /* 脚注 */
  ctx.fillStyle = LINE;
  ctx.fillRect(44, H - 74, W - 88, 2);
  ctx.fillStyle = SUB;
  ctx.font = "14px sans-serif";
  ctx.fillText(
    `地域全体の集計結果は、後日自治会からお知らせします。　保存日 ${new Date().toISOString().slice(0, 10)}`,
    44, H - 44
  );
}

export default function ResultImage({ master, result, roundLabel, assocName, weak }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  const make = () => {
    setBusy(true);
    try {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      render(canvas, { master, result, roundLabel, assocName, weak });
      setUrl(canvas.toDataURL("image/png"));
    } catch {
      setUrl("");
    } finally { setBusy(false); }
  };

  return (
    <div className="ri">
      <style>{RI_CSS}</style>

      {!url ? (
        <button className="bs-btn ghost" disabled={busy} onClick={make}>
          {busy ? "作っています…" : "結果を画像で保存する"}
        </button>
      ) : (
        <div className="ri-out">
          <p className="ri-how">
            下の画像を<b>長押し</b>して「写真に追加」「画像を保存」を選ぶと、
            端末に残せます。パソコンの場合は右クリックか、下のボタンから保存できます。
          </p>
          <img src={url} alt="あなたの回答結果" className="ri-img" />
          <div className="bs-actions">
            <a className="bs-btn ghost" href={url} download="防災力アンケート結果.png">
              画像をダウンロード
            </a>
            <button className="bs-btn ghost" onClick={() => setUrl("")}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

const RI_CSS = `
.ri{margin-top:4px;}
.ri-out{margin-top:8px;}
.ri-how{font-size:15px;line-height:1.7;background:var(--amber-l);
 border-left:5px solid var(--amber);padding:11px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;}
.ri-img{display:block;width:100%;max-width:520px;height:auto;border:2px solid var(--line);
 border-radius:6px;}
@media print{.ri{display:none;}}
`;
