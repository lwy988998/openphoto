import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor() { this.children = []; this.attributes = {}; this.style = {}; this.hidden = true; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/progress.js', import.meta.url), 'utf8'), {
  window, document: { createElement: () => new Element() },
});
const progress = new Element();
window.renderGoldProgress(progress, { stage: 'styling', status: 'processing' }, false);
assert.equal(progress.children[1].attributes['aria-valuenow'], '1');
assert.equal(progress.children[1].children[0].style.transform, 'scaleX(0.5)');
assert.match(progress.children[2].textContent, /AI 调色/);
window.renderGoldProgress(progress, { stage: 'completed', status: 'completed' }, true);
assert.equal(progress.children[1].children[0].style.transform, 'scaleX(1)');
assert.equal(progress.children[0].children.length, 4);
console.log('PROGRESS colorStages=true referenceStages=true completed=true');
