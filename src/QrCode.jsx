/**
 * 地域防災力評価システム / 回答URLのQRコード
 *
 * 置き場所： src/QrCode.jsx
 * AdminDashboard.jsx（調査回の管理）から呼び出して使います。
 *
 * 調査回ごとの回答URLをQRコードにして画面に出し、
 * PNG画像として保存できるようにします。
 * 保存した画像は、回覧板・掲示板・広報紙・アンケート用紙などに
 * そのまま貼り付けて使えます。
 */
import React, { useMemo, useState } from "react";
import { qrDataUrl, downloadQrPng, safeFileName } from "./lib/qr";

/** QRコードを1つ描くだけの部品。用紙の印刷からも使います */
export function QrImage({ text, size = 200, alt = "回答用QRコード", style }) {
  const src = useMemo(() => {
    try {
      return qrDataUrl(text, { size: Math.max(320, size * 3) });
    } catch {
      return "";
    }
  }, [text, size]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ display: "block", width: size, height: size, ...style }}
    />
  );
}

/**
 * QRコードと回答URLをまとめて見せる箱。
 * 調査回の一覧から「QRコード」を押すと開きます。
 */
export default function QrPanel({ url, roundLabel, assocName, onClose }) {
  const [copied, setCopied] = useState("");

  if (!url) return null;

  const baseName = safeFileName(`${assocName ?? "自治会"}_${roundLabel ?? "調査回"}_回答QR`);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${what}をコピーしました。`);
    } catch {
      setCopied("コピーできませんでした。文字を選んでコピーしてください。");
    }
  };

  return (
    <div className="qr-box">
      <style>{QR_CSS}</style>

      <div className="qr-main">
        <div className="qr-pic">
          <QrImage text={url} size={190} alt={`${roundLabel ?? ""}の回答用QRコード`} />
        </div>

        <div className="qr-side">
          <h3>{roundLabel}</h3>
          <p className="dz-muted">
            スマートフォンのカメラでこのQRコードを読み取ると、回答画面が開きます。
            画像として保存すれば、回覧板やお知らせにそのまま貼り付けられます。
          </p>

          <div className="qr-url">
            <span className="k">回答URL</span>
            <span className="v">{url}</span>
          </div>

          <div className="dz-actions">
            <button className="dz-btn" onClick={() => downloadQrPng(url, `${baseName}.png`)}>
              QRコードを画像で保存
            </button>
            <button className="dz-btn ghost" onClick={() => copy(url, "回答URL")}>
              回答URLをコピー
            </button>
            {onClose && (
              <button className="dz-btn ghost" onClick={onClose}>閉じる</button>
            )}
          </div>

          {copied && <p className="dz-note" style={{ marginTop: 12 }}>{copied}</p>}

          <p className="dz-muted" style={{ marginTop: 12, fontSize: 12 }}>
            保存されるのは 1200ピクセル前後のPNG画像です。
            A4に4分の1ほどの大きさで刷ってもつぶれません。
            受付を終了すると、このQRコードからは回答できなくなります。
          </p>
        </div>
      </div>
    </div>
  );
}

const QR_CSS = `
.qr-box{margin-top:16px;padding:16px;background:var(--paper);border-radius:8px;}
.qr-main{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;}
.qr-pic{flex:none;background:#fff;padding:10px;border:1px solid var(--line);border-radius:6px;}
.qr-side{flex:1 1 300px;min-width:260px;}
.qr-side h3{margin:0 0 4px;font-size:16px;font-weight:900;}
.qr-url{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:6px;padding:10px 12px;}
.qr-url .k{display:block;font-size:11px;letter-spacing:.14em;color:var(--sub);}
.qr-url .v{display:block;font-size:13px;word-break:break-all;line-height:1.5;}
`;
