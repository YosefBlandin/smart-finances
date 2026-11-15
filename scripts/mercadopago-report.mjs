#!/usr/bin/env node
// Local helper for the Mercado Pago "released money" reports API (v1/account/release_report).
// Run it on your own machine. The token is never printed, stored or committed. It comes from
// MP_ACCESS_TOKEN in the environment, or else from ACCESS_TOKEN in .env.mercadopago at the repo root
// (git-ignored; keep it chmod 600):
//
//   read -s MP_ACCESS_TOKEN && export MP_ACCESS_TOKEN     # or: paste the token, press Enter
//   node scripts/mercadopago-report.mjs show-config
//   node scripts/mercadopago-report.mjs config                 # creates, or updates if one exists
//   node scripts/mercadopago-report.mjs create 2026-08-01 2026-08-31   # end date is inclusive
//   node scripts/mercadopago-report.mjs list
//   node scripts/mercadopago-report.mjs download <file_name>   # saved to data/real/mercadopago/
//
// Or let sync do create, list and download for every month that is missing, then run the importer:
//
//   node scripts/mercadopago-report.mjs sync                   # earliest month on disk to last month
//   node scripts/mercadopago-report.mjs sync --from 2026-01 --to 2026-10 --no-ingest --wait 20
//   node scripts/mercadopago-report.mjs schedule on|off|status # Mercado Pago's own monthly generation
//   node scripts/mercadopago-report.mjs probe 2026-10          # does the Payments API name the other party?
//
// sync fetches a month again when the file on disk was generated before that month ended or has no
// enrichment columns, and moves the old file to data/real/mercadopago/replaced/. It adds the merchant name,
// category code and recipient key per operation (ADR 0010) and drops the payer name and payout account
// columns before saving. Run `config` once first: sync stops until the config holds those two columns.
// Files it saves are named release-YYYY-MM.csv. The hashing key for recipient keys is
// data/real/mercadopago/.hashing-key (created on first use, mode 600); back it up.
//
// Docs: https://mercadopago.cl/developers/en/docs/reports/released-money/api
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from './mercadopago-probe.mjs';
import { BASE, loadToken, mercadoPagoApi, REPORT_COLUMNS, reportFolder, sync, utcMidnightAR, YM } from './mercadopago-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = loadToken({ root });
if (!token) {
  console.error('Set MP_ACCESS_TOKEN or add ACCESS_TOKEN to .env.mercadopago first. See the comment at the top of this file.');
  process.exit(1);
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

function show({ status, text }) {
  console.log(`HTTP ${status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 2000));
  }
}

function flags(args) {
  const out = { ingest: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--no-ingest') out.ingest = false;
    else if (arg === '--from' || arg === '--to') out[arg.slice(2)] = args[(i += 1)];
    else if (arg === '--wait') out.waitMinutes = Number(args[(i += 1)]);
    else throw new Error(`unknown option ${arg}`);
  }
  if (out.waitMinutes !== undefined && !(out.waitMinutes >= 0)) throw new Error('--wait takes minutes, for example --wait 20');
  return out;
}

const [cmd, a, b] = process.argv.slice(2);

switch (cmd) {
  case 'show-config':
    show(await call('GET', `${BASE}/config`));
    break;
  case 'config': {
    // Pass a JSON file as the 2nd argument to override. The default columns are REPORT_COLUMNS in
    // mercadopago-sync.mjs: the 15 the live report has, plus PAYER_NAME and PAYOUT_BANK_ACCOUNT_NUMBER, which
    // sync needs to name senders and key payouts and drops before it saves a file (D-19). Apply it once before
    // the first enriched sync; to revert, run config with a file that lists the 15 columns.
    const body = a
      ? JSON.parse(readFileSync(a, 'utf8'))
      : {
          file_name_prefix: 'release-report-smart-finances',
          include_withdrawal_at_end: true,
          execute_after_withdrawal: false,
          display_timezone: 'GMT-03',
          frequency: { hour: 0, type: 'monthly', value: 1 },
          // Card digits and authorization codes are left out on purpose.
          columns: REPORT_COLUMNS.map((key) => ({ key })),
        };
    // POST creates the config and answers 409 once one exists; PUT updates the existing one.
    const created = await call('POST', `${BASE}/config`, body);
    if (created.status === 409) {
      console.log('POST answered 409, so a config exists; updating it with PUT');
      show(await call('PUT', `${BASE}/config`, body));
    } else {
      show(created);
    }
    break;
  }
  case 'create':
    if (!a || !b) throw new Error('usage: create <first day> <last day, inclusive> as YYYY-MM-DD');
    show(await call('POST', BASE, { begin_date: utcMidnightAR(a), end_date: utcMidnightAR(b) }));
    break;
  case 'list':
    show(await call('GET', `${BASE}/list`));
    break;
  case 'download': {
    if (!a) throw new Error('usage: download <file_name>');
    const res = await fetch(`${BASE}/${encodeURIComponent(a)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.log(`HTTP ${res.status}`, (await res.text()).slice(0, 500));
      process.exit(1);
    }
    const dir = path.join(root, 'data/real/mercadopago');
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, path.basename(a));
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${out}`);
    break;
  }
  case 'sync': {
    const opts = flags(process.argv.slice(3));
    const result = await sync({
      api: mercadoPagoApi(token),
      folder: reportFolder(path.join(root, 'data/real/mercadopago')),
      from: opts.from,
      to: opts.to,
      ...(opts.waitMinutes !== undefined ? { waitMinutes: opts.waitMinutes } : {}),
    });
    const changed = result.fetched.length + result.setAside.length > 0;
    if (changed && opts.ingest) {
      console.log('\nRunning the importer on data/real/');
      const ingest = spawnSync(process.execPath, [path.join(root, 'scripts/ingest-local.mjs')], { stdio: 'inherit' });
      if (ingest.status !== 0) process.exitCode = ingest.status ?? 1;
    }
    if (result.failed.length || result.pending.length) process.exitCode = 1;
    break;
  }
  case 'probe': {
    // Checks whether the Payments API names the other party; see scripts/mercadopago-probe.mjs.
    if (!YM.test(a ?? '')) throw new Error('usage: probe YYYY-MM');
    await probe({ api: mercadoPagoApi(token), files: reportFolder(path.join(root, 'data/real/mercadopago')).read(), ym: a });
    break;
  }
  case 'schedule': {
    // Turning it on makes Mercado Pago generate the report on the config's frequency (monthly, day 1);
    // sync then finds that report instead of asking for a new one. To change the frequency, turn it
    // off, run config, and turn it on again (Mercado Pago docs).
    const api = mercadoPagoApi(token);
    if (a === 'on' || a === 'off') {
      const res = await api.schedule(a === 'on');
      console.log(`HTTP ${res.status}${res.status === 200 ? `: automatic generation is ${a}` : ` ${res.text.slice(0, 500)}`}`);
    } else if (a === 'status') {
      const res = await api.config();
      if (res.status !== 200) console.log(`HTTP ${res.status} ${res.text.slice(0, 500)}`);
      else console.log(`scheduled: ${res.data?.scheduled === true}; frequency: ${JSON.stringify(res.data?.frequency ?? null)}`);
    } else {
      throw new Error('usage: schedule on|off|status');
    }
    break;
  }
  default:
    console.log('commands: probe YYYY-MM | sync [--from YYYY-MM] [--to YYYY-MM] [--no-ingest] [--wait <minutes>] | schedule on|off|status | show-config | config [file.json] | create <from> <to> | list | download <file_name>');
}
