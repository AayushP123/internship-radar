const CATALOG_URL =
  "https://raw.githubusercontent.com/AayushP123/internship-radar/main/companies.json";

const SHARD_COUNT = 4;
const ALERT_CAP = 10;
const INTERNSHIP_TERMS = ["intern", "internship", "co-op", "coop"];
const ROLE_TERMS = [
  "software engineer",
  "software engineering",
  "software developer",
  "backend engineer",
  "back-end engineer",
  "frontend engineer",
  "front-end engineer",
  "full stack",
  "full-stack",
  "mobile engineer",
  "ios engineer",
  "android engineer",
  "platform engineer",
  "site reliability",
  "devops engineer",
  "machine learning engineer",
  "ml engineer",
  "data engineer",
  "security engineer",
  "systems engineer",
  "firmware engineer",
  "embedded software",
  "quantitative developer",
  "developer intern",
];
const EXCLUDED_TITLES = [
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "mba",
  "legal",
  "sales",
  "technical support",
  "support engineer",
  "hardware",
  "mechanical",
  "electrical",
  "product design",
  "solutions engineer",
];
const EXCLUDED_LOCATIONS = [
  "london",
  "united kingdom",
  "canada",
  "toronto",
  "vancouver",
  "montreal",
  "india",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "pune",
  "singapore",
  "australia",
  "sydney",
  "melbourne",
  "germany",
  "berlin",
  "france",
  "paris",
  "netherlands",
  "amsterdam",
  "ireland",
  "dublin",
];
const ALLOWED_LOCATIONS = [
  "united states",
  "usa",
  "u.s.",
  "us",
  "remote",
  "new york",
  "san francisco",
  "bay area",
  "seattle",
  "austin",
  "boston",
  "chicago",
  "los angeles",
  "california",
  "washington",
  "texas",
  "massachusetts",
  "arizona",
  "colorado",
  "virginia",
  "maryland",
  "pennsylvania",
  "north carolina",
  "georgia",
  "florida",
  "ohio",
  "michigan",
  "illinois",
  "oregon",
  "new jersey",
  "district of columbia",
];

function normalize(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clean(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(text, term) {
  const needle = normalize(term);
  if (!needle.includes(" ") && /^[a-z0-9]+$/.test(needle)) {
    return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
  }
  return text.includes(needle);
}

function includesAny(text, terms) {
  return terms.some((term) => containsTerm(text, term));
}

function matches(job) {
  const title = normalize(job.title);
  const location = normalize(job.location);
  if (!includesAny(title, INTERNSHIP_TERMS)) return false;
  if (!includesAny(title, ROLE_TERMS)) return false;
  if (includesAny(title, EXCLUDED_TITLES)) return false;
  if (location && includesAny(location, EXCLUDED_LOCATIONS)) return false;
  if (location && !includesAny(location, ALLOWED_LOCATIONS)) return false;
  return Boolean(job.url);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "InternshipRadar-Cloudflare/1.0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchGreenhouse(company) {
  const slug = encodeURIComponent(company.slug);
  const data = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  );
  return (data.jobs || []).map((item) => ({
    company: company.name,
    title: clean(item.title),
    location: clean(item.location?.name),
    url:
      item.absolute_url ||
      `https://boards.greenhouse.io/${slug}/jobs/${item.id}`,
  }));
}

async function fetchAshby(company) {
  const data = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}`,
  );
  return (data.jobs || []).map((item) => {
    let location = clean(item.location);
    if (item.isRemote && !normalize(location).includes("remote")) {
      location = `${location} / Remote`.replace(/^ \/ | \/ $/g, "");
    }
    return {
      company: company.name,
      title: clean(item.title),
      location,
      url: item.jobUrl || item.applyUrl || "",
    };
  });
}

async function fetchLever(company) {
  const data = await fetchJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`,
  );
  return (data || []).map((item) => ({
    company: company.name,
    title: clean(item.text),
    location: clean(item.categories?.location || item.workplaceType),
    url: item.hostedUrl || item.applyUrl || "",
  }));
}

async function fetchCompany(company) {
  if (company.provider === "greenhouse") return fetchGreenhouse(company);
  if (company.provider === "ashby") return fetchAshby(company);
  if (company.provider === "lever") return fetchLever(company);
  return [];
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

async function fingerprint(job) {
  return sha256(
    [normalize(job.company), normalize(job.title), normalize(job.location), job.url]
      .join("|"),
  );
}

async function inBatches(items, width, task) {
  const output = [];
  const errors = [];
  for (let index = 0; index < items.length; index += width) {
    const chunk = items.slice(index, index + width);
    const settled = await Promise.allSettled(chunk.map(task));
    for (let offset = 0; offset < settled.length; offset += 1) {
      const result = settled[offset];
      if (result.status === "fulfilled") output.push(...result.value);
      else errors.push(`${chunk[offset].name}: ${result.reason}`);
    }
  }
  return { output, errors };
}

async function sendNotification(env, job) {
  const response = await fetch("https://ntfy.sh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC,
      title: "New SWE internship",
      message: `${job.company} — ${job.title}\n${job.location || "Location not listed"}`,
      priority: 4,
      tags: ["computer", "briefcase"],
      click: job.url,
      actions: [
        {
          action: "view",
          label: "Apply",
          url: job.url,
          clear: true,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`ntfy ${response.status}: ${await response.text()}`);
  }
}

async function runShard(env, shard) {
  const startedAt = new Date().toISOString();
  const catalog = await fetchJson(CATALOG_URL);
  const live = catalog.filter((company) => company.enabled !== false);
  const companies = live.filter((_, index) => index % SHARD_COUNT === shard);
  const { output: jobs, errors } = await inBatches(companies, 6, fetchCompany);
  const matched = jobs.filter(matches);
  const stateKey = `state:${shard}`;
  const previous = (await env.SEEN.get(stateKey, "json")) || {
    initialized: false,
    seen: [],
  };
  const seen = new Set(previous.seen || []);
  const keyed = [];
  for (const job of matched) keyed.push([await fingerprint(job), job]);

  let sent = 0;
  if (!previous.initialized) {
    for (const [key] of keyed) seen.add(key);
  } else {
    for (const [key, job] of keyed) {
      if (seen.has(key) || sent >= ALERT_CAP) continue;
      await sendNotification(env, job);
      seen.add(key);
      sent += 1;
    }
  }

  const state = {
    initialized: true,
    seen: [...seen],
  };
  if (!previous.initialized || sent > 0) {
    await env.SEEN.put(stateKey, JSON.stringify(state));
  }

  const status = {
    shard,
    startedAt,
    completedAt: new Date().toISOString(),
    companies: companies.length,
    jobs: jobs.length,
    matched: matched.length,
    matchedJobs: matched.map(({ company, title, location, url }) => ({
      company,
      title,
      location,
      url,
    })),
    sent,
    errors: errors.slice(0, 10),
  };
  await env.SEEN.put(`status:${shard}`, JSON.stringify(status), {
    expirationTtl: 604800,
  });
  return status;
}

async function readStatus(env) {
  const statuses = await Promise.all(
    [...Array(SHARD_COUNT).keys()].map((shard) =>
      env.SEEN.get(`status:${shard}`, "json"),
    ),
  );
  const now = Date.now();
  const fresh = statuses.every(
    (status) =>
      status &&
      now - Date.parse(status.completedAt) < 12 * 60 * 1000,
  );
  const jobs = statuses
    .flatMap((status) => status?.matchedJobs || [])
    .sort((a, b) =>
      `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`),
    );
  const companyCount = statuses.reduce(
    (total, status) => total + (status?.companies || 0),
    0,
  );
  return {
    service: "Internship Radar",
    healthy: fresh,
    schedule: "One queue-driven shard per minute; every company every 4 minutes",
    lastUpdated: statuses
      .filter(Boolean)
      .map((status) => status.completedAt)
      .sort()
      .at(-1),
    companyCount,
    currentPostings: jobs,
    shards: statuses,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dashboard(data) {
  const cards = data.currentPostings.length
    ? data.currentPostings
        .map(
          (job) => `
          <a class="job" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">
            <div class="company">${escapeHtml(job.company)}</div>
            <div class="title">${escapeHtml(job.title)}</div>
            <div class="location">${escapeHtml(job.location || "Location not listed")}</div>
            <div class="apply">Open application →</div>
          </a>`,
        )
        .join("")
    : '<div class="empty">Postings are refreshing. Reload in a few minutes.</div>';
  const updated = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString("en-US", {
        timeZone: "America/Phoenix",
        timeZoneName: "short",
      })
    : "Waiting for first refresh";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Internship Radar</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #080b12; color: #f4f7ff; }
    main { max-width: 850px; margin: auto; padding: 32px 18px 60px; }
    h1 { font-size: clamp(28px, 7vw, 48px); margin: 0 0 8px; letter-spacing: -1.5px; }
    .status { color: #aeb8cf; margin-bottom: 18px; line-height: 1.6; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; background: ${data.healthy ? "#39d98a" : "#ffbf47"}; }
    .controls { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .sync { color: #8f9bb3; font-size: 13px; }
    button { appearance: none; border: 1px solid #35415f; border-radius: 10px; padding: 9px 13px; background: #171e30; color: #f4f7ff; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { border-color: #667eea; }
    button:disabled { opacity: .65; cursor: wait; }
    .jobs { display: grid; gap: 12px; }
    .job { display: block; padding: 18px; color: inherit; text-decoration: none; background: #121725; border: 1px solid #252d41; border-radius: 14px; transition: .15s ease; }
    .job:hover { transform: translateY(-2px); border-color: #667eea; background: #171e30; }
    .company { color: #91a7ff; font-size: 14px; font-weight: 700; }
    .title { font-size: 19px; font-weight: 750; margin: 5px 0; }
    .location { color: #aeb8cf; font-size: 14px; }
    .apply { margin-top: 14px; color: #70d6ff; font-weight: 650; font-size: 14px; }
    .empty { padding: 30px; background: #121725; border-radius: 14px; color: #aeb8cf; }
  </style>
</head>
<body><main>
  <h1>Internship Radar</h1>
  <div class="status">
    <span class="dot" id="health-dot"></span><span id="health">${data.healthy ? "Monitor online" : "Monitor refreshing"}</span><br>
    <span id="count">${data.currentPostings.length}</span> current matching postings · Last checked <span id="updated">${escapeHtml(updated)}</span><br>
    <span id="coverage">${data.companyCount || 0}</span> companies scanned; every company is checked about every 4 minutes.
  </div>
  <div class="controls">
    <button id="refresh" type="button">Refresh now</button>
    <span class="sync" id="sync">Live sync starting…</span>
  </div>
  <div class="jobs" id="jobs">${cards}</div>
  <noscript><meta http-equiv="refresh" content="60"></noscript>
  <script>
    (() => {
      const jobs = document.getElementById("jobs");
      const refreshButton = document.getElementById("refresh");
      const sync = document.getElementById("sync");
      let lastSync = 0;

      function formatTime(value) {
        if (!value) return "Waiting for first refresh";
        return new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Phoenix",
          month: "numeric",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(new Date(value));
      }

      function createJob(job) {
        const card = document.createElement("a");
        card.className = "job";
        card.href = job.url;
        card.target = "_blank";
        card.rel = "noopener";
        const company = document.createElement("div");
        company.className = "company";
        company.textContent = job.company;
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = job.title;
        const location = document.createElement("div");
        location.className = "location";
        location.textContent = job.location || "Location not listed";
        const apply = document.createElement("div");
        apply.className = "apply";
        apply.textContent = "Open application →";
        card.append(company, title, location, apply);
        return card;
      }

      function render(data) {
        document.getElementById("health").textContent =
          data.healthy ? "Monitor online" : "Monitor refreshing";
        document.getElementById("health-dot").style.background =
          data.healthy ? "#39d98a" : "#ffbf47";
        document.getElementById("count").textContent =
          data.currentPostings.length;
        document.getElementById("updated").textContent =
          formatTime(data.lastUpdated);
        document.getElementById("coverage").textContent =
          data.companyCount || 0;
        jobs.replaceChildren();
        if (!data.currentPostings.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent =
            "No matching postings are live right now. Monitoring continues.";
          jobs.append(empty);
          return;
        }
        jobs.append(...data.currentPostings.map(createJob));
      }

      function updateSyncLabel() {
        if (!lastSync) return;
        const seconds = Math.max(
          0,
          Math.floor((Date.now() - lastSync) / 1000),
        );
        sync.textContent =
          seconds < 2
            ? "Live data synced just now"
            : "Live data synced " + seconds + "s ago";
      }

      async function refresh() {
        refreshButton.disabled = true;
        sync.textContent = "Checking live data…";
        try {
          const response = await fetch("/status?ts=" + Date.now(), {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Status request failed");
          render(await response.json());
          lastSync = Date.now();
          updateSyncLabel();
        } catch (error) {
          sync.textContent =
            "Could not sync; retrying automatically (" +
            (error?.message || "unknown error") +
            ")";
        } finally {
          refreshButton.disabled = false;
        }
      }

      refreshButton.addEventListener("click", refresh);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refresh();
      });
      setInterval(refresh, 15000);
      setInterval(updateSyncLabel, 1000);
      refresh();
    })();
  </script>
</main></body>
</html>`;
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const shard = Number(message.body?.shard);
      if (!Number.isInteger(shard) || shard < 0 || shard >= SHARD_COUNT) {
        throw new Error(`Invalid queue shard: ${message.body?.shard}`);
      }
      await runShard(env, shard);
      await env.TICKS.send(
        { shard: (shard + 1) % SHARD_COUNT },
        { delaySeconds: 60 },
      );
      message.ack();
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const data = await readStatus(env);
    if (url.pathname === "/") {
      return new Response(dashboard(data), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }
    if (url.pathname === "/status") {
      return Response.json(data, {
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
