// Public, cached traffic summary. The Vercel Analytics token never reaches the browser.
const PROJECT_ID = process.env.VERCEL_ANALYTICS_PROJECT_ID || process.env.VERCEL_PROJECT_ID || "prj_TXjIz88GHbYRw85KSKtaX3vdLzVA";
const TEAM_ID = process.env.VERCEL_ANALYTICS_TEAM_ID || process.env.VERCEL_TEAM_ID || "team_nRdGzntRZAxuwv1ZxDUybLd3";

function thaiDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const date = new Date(Date.UTC(
    Number(parts.find(part => part.type === "year").value),
    Number(parts.find(part => part.type === "month").value) - 1,
    Number(parts.find(part => part.type === "day").value) + offsetDays,
  ));
  return date.toISOString().slice(0, 10);
}

async function query(path, params, token) {
  const url = new URL(`https://api.vercel.com/v1/query/web-analytics/${path}`);
  url.search = new URLSearchParams({ projectId: PROJECT_ID, teamId: TEAM_ID, ...params });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("analytics unavailable");
  return response.json();
}

function metric(data, name) {
  return Number.isFinite(data?.data?.[name]) ? data.data[name] : 0;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  const token = process.env.VERCEL_ANALYTICS_TOKEN || process.env.VERCEL_TOKEN;
  if (!token) return res.status(200).json({ ok: false, configured: false });
  try {
    const since = thaiDate();
    const until = thaiDate(1);
    const [today, lifetime] = await Promise.all([
      query("visits/aggregate", { since, until, by: "day" }, token),
      query("visits/count", {}, token),
    ]);
    const rows = Array.isArray(today?.data) ? today.data : [];
    const todayVisitors = rows.reduce((sum, row) => sum + (Number(row?.visitors) || 0), 0);
    const todayPageviews = rows.reduce((sum, row) => sum + (Number(row?.pageviews) || 0), 0);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, todayVisitors, todayPageviews,
      totalPageviews: metric(lifetime, "pageviews"), updatedAt: new Date().toISOString() });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
