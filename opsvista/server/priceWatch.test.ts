import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPriceWatch } from './priceWatch.js';

test('Price Watch retries individual invoice details when R365 returns an empty OR-filter page', async () => {
  const oldFetch = globalThis.fetch;
  const oldDomain = process.env.RESTAURANT365_DOMAIN;
  const oldUser = process.env.RESTAURANT365_USERNAME;
  const oldPassword = process.env.RESTAURANT365_PASSWORD;
  const oldDatabase = process.env.OPSVISTA_DATABASE_URL;
  process.env.RESTAURANT365_DOMAIN = 'test';
  process.env.RESTAURANT365_USERNAME = 'test';
  process.env.RESTAURANT365_PASSWORD = 'test-password';
  delete process.env.OPSVISTA_DATABASE_URL;
  const detailRequests: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const view = url.pathname.split('/').pop();
    const filter = url.searchParams.get('$filter') || '';
    let value: Record<string, unknown>[] = [];
    if (view === 'Transaction') value = [
      {transactionId:'tx1',type:'AP Invoice',date:'2026-10-16',companyId:'vendor1',locationName:'Orange',transactionNumber:'INV-1'},
      {transactionId:'tx2',type:'AP Invoice',date:'2026-10-16',companyId:'vendor1',locationName:'Orange',transactionNumber:'INV-2'},
    ];
    if (view === 'Company') value = [{companyId:'vendor1',name:'Test Vendor'}];
    if (view === 'TransactionDetail') {
      detailRequests.push(filter);
      if (!filter.includes(' or ')) value = [{transactionId:filter.includes('tx1')?'tx1':'tx2',itemId:'item1',itemName:'Test Product',vendorItemNumber:'SKU1',quantity:1,unitOfMeasure:'Each',unitPrice:10,lineAmount:10}];
    }
    return new Response(JSON.stringify({value}), {status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result = await getPriceWatch('org-puerto-vallarta', '2026-10-16', '2026-10-16', true);
    assert.equal(result.sourceCoverage.invoices, 2);
    assert.equal(result.sourceCoverage.itemLines, 2);
    assert.equal(result.summary.items, 1);
    assert.equal(detailRequests.length, 3);
    assert.ok(detailRequests[0].includes(' or '));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDomain === undefined) delete process.env.RESTAURANT365_DOMAIN; else process.env.RESTAURANT365_DOMAIN = oldDomain;
    if (oldUser === undefined) delete process.env.RESTAURANT365_USERNAME; else process.env.RESTAURANT365_USERNAME = oldUser;
    if (oldPassword === undefined) delete process.env.RESTAURANT365_PASSWORD; else process.env.RESTAURANT365_PASSWORD = oldPassword;
    if (oldDatabase === undefined) delete process.env.OPSVISTA_DATABASE_URL; else process.env.OPSVISTA_DATABASE_URL = oldDatabase;
  }
});
