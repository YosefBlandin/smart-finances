#!/usr/bin/env node
// Local helper for the Mercado Pago "released money" reports API (v1/account/release_report).
// Run it on your own machine. The token comes from the environment and is never printed,
// stored or committed:
//
//   read -s MP_ACCESS_TOKEN && export MP_ACCESS_TOKEN     # paste the token, press Enter
//   node scripts/mercadopago-report.mjs show-config
//   node scripts/mercadopago-report.mjs config                 # one-time setup
//   node scripts/mercadopago-report.mjs create 2026-08-01 2026-08-31   # end date is inclusive
//   node scripts/mercadopago-report.mjs list
//   node scripts/mercadopago-report.mjs download <file_name>   # saved to data/real/mercadopago/
//
// Docs: https://mercadopago.cl/developers/en/docs/reports/released-money/api
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.mercadopago.com/v1/account/release_report';
const token = process.env.MP_ACCESS_TOKEN;
if (!token) {
  console.error('Set MP_ACCESS_TOKEN first. See the comment at the top of this file.');
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

// Argentina is UTC-3 all year, so local midnight is 03:00 UTC. The API treats the end date as
// INCLUSIVE of that whole local day (it stretches it to 23:59:59), so pass the last day of the month.
const utcMidnightAR = (ymd) => `${ymd}T03:00:00Z`;

const [cmd, a, b] = process.argv.slice(2);

switch (cmd) {
  case 'show-config':
    show(await call('GET', `${BASE}/config`));
    break;
  case 'config': {
    // Pass a JSON file as the 2nd argument to override. Column keys are not verified yet, so the
    // default omits `columns` and lets the API choose; add them in a file once we see an error or the CSV.
    const body = a
      ? JSON.parse(readFileSync(a, 'utf8'))
      : {
          file_name_prefix: 'release-report-smart-finances',
          include_withdrawal_at_end: true,
          execute_after_withdrawal: false,
          display_timezone: 'GMT-03',
          frequency: { hour: 0, type: 'monthly', value: 1 },
        };
    show(await call('POST', `${BASE}/config`, body));
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
    const dir = path.resolve('data/real/mercadopago');
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, path.basename(a));
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${out}`);
    break;
  }
  default:
    console.log('commands: show-config | config [file.json] | create <from> <to> | list | download <file_name>');
}
