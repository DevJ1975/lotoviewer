// node --test tests/js/mark-rules.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../walkdown/static/walkdown/mark-rules.js', import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox);
const rules = sandbox.WalkdownMarkRules;

// Objects built inside the VM carry another realm's prototypes, so compare as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const decide = (input) => plain(rules.decideMark(input));
const arrowsFor = (input) => plain(rules.startingArrows(input));
const target = (input) => plain(rules.saveTarget(input));

const photo = { client_capture_id: 'p1', kind: 'photo', annotations: [{ x1: 0 }] };

test('a photo waiting to upload can always be marked', () => {
  for (const hasPhoto of [true, false]) {
    for (const canMark of [true, false]) {
      assert.equal(decide({ queuedPhoto: photo, hasPhoto, canMark }).action, 'edit');
    }
  }
});

test('an existing photo is marked only when the audit allows it', () => {
  assert.equal(decide({ hasPhoto: true, canMark: true }).action, 'edit');
  assert.deepEqual(decide({ hasPhoto: true, canMark: false }), { action: 'take_photo', reason: 'wrong_photo' });
});

test('no photo at all means take one first', () => {
  assert.deepEqual(decide({ hasPhoto: false, canMark: false }), { action: 'take_photo', reason: 'no_photo' });
});

test('every refusal reason has a message that says what to do next', () => {
  for (const reason of ['no_photo', 'wrong_photo']) {
    assert.match(rules.TAKE_PHOTO_MESSAGES[reason], /Take (one|a new photo)/);
  }
});

test('the button label never promises what it will refuse', () => {
  assert.equal(rules.buttonLabel({ queuedPhoto: photo, hasPhoto: false, canMark: false }),
    'Mark isolation point (arrow)');
  assert.equal(rules.buttonLabel({ hasPhoto: true, canMark: true }), 'Mark isolation point (arrow)');
  assert.equal(rules.buttonLabel({ hasPhoto: true, canMark: false }), 'Take photo, then mark arrow');
});

test('arrows on the old placard photo are not shown on a new photo', () => {
  const serverArrows = [{ x1: 0.9 }];
  assert.deepEqual(arrowsFor({ queuedPhoto: { annotations: [] }, serverArrows }), []);
  assert.deepEqual(arrowsFor({ queuedPhoto: photo, serverArrows }), photo.annotations);
  assert.deepEqual(arrowsFor({ queuedAnnotate: { annotations: [{ x1: 0.2 }] }, serverArrows }), [{ x1: 0.2 }]);
  assert.deepEqual(arrowsFor({ serverArrows }), serverArrows);
});

test('arrows go on the photo while it waits, and follow it once it has uploaded', () => {
  assert.deepEqual(target({ queuedPhoto: photo, stillQueued: photo }), { action: 'attach' });
  // The regression: online, the photo uploads while the editor is open.
  assert.deepEqual(target({ queuedPhoto: photo, stillQueued: undefined }),
    { action: 'annotate_for_photo', forCapture: 'p1' });
  assert.deepEqual(target({}), { action: 'annotate_existing' });
});
