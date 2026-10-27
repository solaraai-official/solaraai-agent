// Fails a release before anything is built when this runner's Node or npm is too old for npm
// trusted publishing (https://docs.npmjs.com/trusted-publishers: npm CLI 11.5.1 or later, Node
// 22.14.0 or later). Without them npm cannot use the job's OIDC token, and the publish would fail
// at the very end, or fall back to a token, which this repository does not have.
//
//   node scripts/check-trusted-publishing.mjs "$(npm --version)" [node version, default this Node]

const MINIMUM = { node: '22.14.0', npm: '11.5.1' };

/** Whether version a is at least version b, both `major.minor.patch` (a pre-release tag ignored). */
function isAtLeast(a, b) {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}

const npm = process.argv[2] ?? '';
const node = process.argv[3] ?? process.versions.node;
if (!/^\d+\.\d+\.\d+/.test(npm)) {
  console.error('usage: node scripts/check-trusted-publishing.mjs "$(npm --version)"');
  process.exit(2);
}
const problems = [];
if (!isAtLeast(node, MINIMUM.node)) problems.push(`Node ${node} (needs ${MINIMUM.node}+)`);
if (!isAtLeast(npm, MINIMUM.npm)) problems.push(`npm ${npm} (needs ${MINIMUM.npm}+)`);
if (problems.length > 0) {
  console.error(`::error::too old for npm trusted publishing: ${problems.join(', ')}`);
  process.exit(1);
}
console.log(`Node ${node} and npm ${npm} can use npm trusted publishing`);
