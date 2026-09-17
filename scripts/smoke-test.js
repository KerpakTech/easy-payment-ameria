import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Ameria from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadEnv = (filePath) => {
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
};

loadEnv(join(__dirname, '..', '.env'));

const client = Ameria.gateway({
  AMERIA_URL: process.env.AMERIA_URL,
  CLIENT_ID: process.env.KERPAK_AMERIA_CLIENT_ID,
  USERNAME: process.env.KERPAK_AMERIA_USERNAME,
  PASSWORD: process.env.KERPAK_AMERIA_PASSWORD,
  TIMEOUT: Number(process.env.REQUEST_TO_BANK_WAITING_TIME) || 40000,
});

// Ameria test env: OrderID must be in 4619001-4620000, Amount 10 AMD
const orderNumber = 4619001 + Math.floor(Math.random() * 1000);
const amountMinor = Number(process.env.DEFAULT_BINDING_AMOUNT || 10) * 100;

const attachResult = await client.attachCard({
  amount: amountMinor,
  orderNumber,
  returnUrl: 'https://staging.kerpaktech.com/api/card/paymentResult/v2',
  description: 'kerpak ameria local smoke test',
  currency: '051',
  language: 'en',
  clientId: `local_test_${Date.now()}`,
});


console.log(JSON.stringify({
  orderNumber,
  amountMinor,
  hasError: attachResult.hasError,
  errorStep: attachResult.errorStep,
  ResponseCode: attachResult.data?.ResponseCode,
  ResponseMessage: attachResult.data?.ResponseMessage,
  PaymentID: attachResult.data?.PaymentID || attachResult.data?.orderId,
  formUrl: attachResult.data?.formUrl,
  err: attachResult.err?.message || attachResult.err,
}, null, 2));

if (attachResult.hasError) process.exit(1);
