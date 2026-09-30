import { StaticJsonPanel } from './StaticJsonPanel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

interface Post { at: string; text: string; url: string; replies: number; reblogs: number; likes: number }
interface PotusData {
  generatedAt: string;
  source: string;
  totalPosts: number;
  perDay: { day: string; posts: number }[];
  latest: Post[];
}

const dim = 'color:var(--text-dim)';
const S = 'calc(11px * var(--wm-panel-effective-scale, 1))';

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export class PotusTrackerPanel extends StaticJsonPanel<PotusData> {
  constructor() {
    super({
      id: 'potus-tracker',
      title: 'POTUS Truth Social',
      showCount: false,
      infoTooltip: "President Trump's Truth Social posts. Source: CNN's public Truth Social archive, refreshed every few hours.",
    }, '/data/potus.json');
  }

  protected render(d: PotusData): string {
    const max = Math.max(1, ...d.perDay.map((x) => x.posts));
    const bars = d.perDay.map((x) => `<div title="${escapeHtml(x.day)}: ${x.posts} posts" style="flex:1;height:${Math.max(3, Math.round((x.posts / max) * 28))}px;background:var(--accent, #4a90e2);opacity:.75;border-radius:2px"></div>`).join('');
    const posts = d.latest.slice(0, 20).map((p) => {
      const text = p.text.length > 360 ? `${p.text.slice(0, 360)}…` : p.text;
      return `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:${S}">
        <div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(text || '(media post)')}</div>
        <div style="${dim};margin-top:2px"><a href="${escapeHtml(sanitizeUrl(p.url))}" target="_blank" rel="noopener noreferrer" style="${dim}">${escapeHtml(ago(p.at))}</a> · ${p.replies.toLocaleString()} replies · ${p.reblogs.toLocaleString()} reposts · ${p.likes.toLocaleString()} likes</div>
      </div>`;
    }).join('');
    return `<div style="padding:10px 14px">
      <div style="font-size:${S};${dim};margin-bottom:4px">Posts per day, last ${d.perDay.length} days · ${d.totalPosts.toLocaleString()} archived</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:30px;margin-bottom:8px">${bars}</div>
      ${posts}
    </div>`;
  }
}
