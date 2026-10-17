import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGepgText, wordsToNumber } from '../app/js/core/gepg.js';

const A = `& Payment Details < ©
aa INSTITUTION
ZL LALA MUNICIPAL COUNCIL
AMOUNT
TZS 30,000.00
THIRTY THOUSAND
Control Number 992041400689
Bank Receipt GWX103558180745
GePG Receipt 926286495029846
Payer Name RAJABU ALLY ISSA
Paid Through NMB
In Respect Of Service Levy
Payment Date Oct 13, 2026
Payment Received Oct 13, 2026
Date`;
const B = A.replace('30,000.00', '100,000.00').replace('THIRTY THOUSAND', 'ONE HUNDRED THOUSAND')
  .replace('992041400689', '992041400052').replace('Service Levy', 'Business Licences');

test('words to number', () => {
  assert.equal(wordsToNumber('ONE HUNDRED THOUSAND'), 100000);
  assert.equal(wordsToNumber('THIRTY THOUSAND'), 30000);
  assert.equal(wordsToNumber('ONE MILLION TWO HUNDRED THOUSAND'), 1200000);
  assert.equal(wordsToNumber('ONE HUNDRED  AND FIFTY THOUSAND'), 150000);
  assert.equal(wordsToNumber('ONE HUNDRED EIGHTY SEVEN THOUSAND FIVE HUNDRED'), 187500);
  assert.equal(wordsToNumber('TH1RTY THOUSAND'), null);
});

test('service levy screenshot', () => {
  const r = parseGepgText(A);
  assert.deepEqual([r.ok, r.cn, r.amount, r.type, r.pay, r.recv], [true, '992041400689', 30000, 'SL', '2026-10-13', '2026-10-13']);
  assert.deepEqual(r.flags, []);
});

test('business licence screenshot (the 100,000 that was typed as 10,000)', () => {
  const r = parseGepgText(B);
  assert.deepEqual([r.cn, r.amount, r.type], ['992041400052', 100000, 'BL']);
  assert.deepEqual(r.flags, []);
});

test('mismatch between digits and words is flagged', () => {
  const r = parseGepgText(A.replace('30,000.00', '80,000.00'));
  assert.ok(r.flags.includes('amount-mismatch'));
});

test('not a payment screen', () => {
  assert.equal(parseGepgText('Control number not found').ok, false);
});

test('payer name is read, including a name that wraps to a second line', () => {
  assert.equal(parseGepgText(A).name, 'RAJABU ALLY ISSA');
  const wrapped = A.replace('Payer Name RAJABU ALLY ISSA', 'Payer Name JACQUILINE JUDICA\nMSAMI');
  assert.equal(parseGepgText(wrapped).name, 'JACQUILINE JUDICA MSAMI');
});
