/**
 * Gjallarhorn email templates — HEIMDALL-branded HTML + plaintext.
 * A small string-template helper, deliberately not a templating dependency.
 * Header carries the Gjallarhorn horn mark; footer signs every message
 * "Sounded by Gjallarhorn · HEIMDALL".
 */

const BRAND_NAVY = '#16203a';
const BRAND_AMBER = '#d99320';

/** Inline-safe horn+clock mark for email headers (renders broadly; clients that strip SVG still get the wordmark text). */
const HORN_SVG = `<svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M 56.8 20.6 C 61 22, 63.3 26.5, 62 30.8 C 56.5 44.5, 44.5 54.8, 31 55.6 C 19.5 56.4, 10 50, 6.5 39.5 C 5.6 36, 6.1 32.6, 7.8 29.8 L 10.6 31.8 C 9.9 33.5, 10 35.3, 10.8 37.3 C 13.8 44.6, 21 49.3, 30.5 48.8 C 41 48, 50.2 40.6, 54.2 30.2 C 54.9 28.2, 55 26.3, 54.6 24.6 C 53.8 23.2, 54.6 21.6, 56.8 20.6 Z" fill="${BRAND_AMBER}"/><circle cx="32" cy="22" r="11.5" stroke="${BRAND_AMBER}" stroke-width="2.5" fill="none"/><path d="M 32 22 L 27.4 19.3" stroke="${BRAND_AMBER}" stroke-width="2.3" stroke-linecap="round"/><path d="M 32 22 L 38.4 18.3" stroke="${BRAND_AMBER}" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="22" r="1.7" fill="${BRAND_AMBER}"/></svg>`;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap body content in the HEIMDALL chrome. `bodyHtml` may contain markup;
 * `bodyText` is the plaintext alternative.
 */
export function renderEmail(opts: {
  subject: string;
  heading: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  orgName?: string;
}): EmailContent {
  const { subject, heading, bodyHtml, bodyText, ctaLabel, ctaUrl, orgName } = opts;
  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND_AMBER};border-radius:6px;">
           <a href="${ctaUrl}" style="display:inline-block;padding:10px 22px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:${BRAND_NAVY};text-decoration:none;">${escapeHtml(ctaLabel)}</a>
         </td></tr></table>`
      : '';

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f6fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- HEIMDALL header -->
        <tr><td style="background:${BRAND_NAVY};padding:18px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;">${HORN_SVG}</td>
            <td style="vertical-align:middle;font-family:Arial,sans-serif;font-size:18px;letter-spacing:4px;font-weight:bold;color:#f4f6fb;">HEIMDALL</td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px;font-family:Arial,sans-serif;color:#1f2a45;">
          <h1 style="margin:0 0 14px;font-size:18px;color:${BRAND_NAVY};">${escapeHtml(heading)}</h1>
          <div style="font-size:14px;line-height:1.6;">${bodyHtml}</div>
          ${cta}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f4f6fb;padding:16px 28px;font-family:Arial,sans-serif;font-size:11px;color:#6f86b5;">
          ${escapeHtml(orgName ?? 'Training Academy')} — automated staffing alert.<br/>
          Sounded by Gjallarhorn · HEIMDALL
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${heading}

${bodyText}
${ctaUrl ? `\n${ctaLabel ?? 'Open'}: ${ctaUrl}\n` : ''}
--
${orgName ?? 'Training Academy'}
Sounded by Gjallarhorn · HEIMDALL`;

  return { subject, html, text };
}

/** Render a definition-list style detail block for session emails. */
export function detailRows(rows: [string, string][]): { html: string; text: string } {
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0;border-left:3px solid ${BRAND_AMBER};">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 12px;font-size:13px;color:#6f86b5;white-space:nowrap;">${escapeHtml(k)}</td>
           <td style="padding:3px 0;font-size:13px;color:#1f2a45;">${escapeHtml(v)}</td></tr>`
      )
      .join('')}
  </table>`;
  const text = rows.map(([k, v]) => `  ${k}: ${v}`).join('\n');
  return { html, text };
}
