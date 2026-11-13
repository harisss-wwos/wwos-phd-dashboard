'use strict';
// In-flight de-duplication: concurrent run(key, fn) calls share one pending promise. Nothing is
// kept after it settles (fulfilled or rejected), so a failure never poisons later calls: the next
// run(key) calls fn again. bump() starts a new generation (call it after a write), so a run that
// starts later never joins a read issued before the write.
function createSingleFlight() {
  const pending = new Map();
  let gen = 0;
  function run(key, fn) {
    const k = gen + ':' + key;
    let p = pending.get(k);
    if (p) return p;
    p = Promise.resolve().then(fn);
    pending.set(k, p);
    const done = () => { if (pending.get(k) === p) pending.delete(k); };
    p.then(done, done);
    return p;
  }
  function bump() { gen++; pending.clear(); }
  return { run, bump, size: () => pending.size };
}

module.exports = { createSingleFlight };
