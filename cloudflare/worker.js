const CATALOG_URL =
  "https://raw.githubusercontent.com/AayushP123/internship-radar/main/companies.json";

const SHARD_CRONS = {
  "1-56/5 * * * *": 0,
  "2-57/5 * * * *": 1,
  "3-58/5 * * * *": 2,
  "4-59/5 * * * *": 3,
};

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
    sent,
    errors: errors.slice(0, 10),
  };
  await env.SEEN.put(`status:${shard}`, JSON.stringify(status), {
    expirationTtl: 604800,
  });
  return status;
}

async function statusResponse(env) {
  const statuses = await Promise.all(
    [...Array(SHARD_COUNT).keys()].map((shard) =>
      env.SEEN.get(`status:${shard}`, "json"),
    ),
  );
  return Response.json({
    service: "Internship Radar",
    healthy: statuses.every(Boolean),
    schedule: "Each company every 5 minutes across four staggered shards",
    shards: statuses,
  });
}

export default {
  async scheduled(controller, env, ctx) {
    const shard = SHARD_CRONS[controller.cron];
    if (shard === undefined) throw new Error(`Unknown cron: ${controller.cron}`);
    ctx.waitUntil(runShard(env, shard));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/status") {
      return statusResponse(env);
    }
    return new Response("Not found", { status: 404 });
  },
};

