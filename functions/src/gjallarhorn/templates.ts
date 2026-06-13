/**
 * Gjallarhorn email templates — HEIMDALL-branded HTML + plaintext.
 * A small string-template helper, deliberately not a templating dependency.
 * Header carries the Gjallarhorn horn mark; footer signs every message
 * "Sounded by Gjallarhorn · HEIMDALL".
 */

const BRAND_NAVY = '#16203a';
const BRAND_AMBER = '#d99320';

/**
 * Brand mark for email headers — hosted PNG (Gmail and many clients strip
 * inline SVG; a hosted image renders reliably and degrades to alt text).
 * TODO(setup): update the host when moving to a custom domain.
 */
const MARK_IMG = `<img src="https://heimdall.tgcmd-portal.com/brand/heimdall-mark.png" width="42" height="30" alt="" style="display:block;border:0;" />`;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
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
            <td style="vertical-align:middle;padding-right:10px;">${MARK_IMG}</td>
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
