// Tiny argv parser shared by the three CLIs: --key value, --key=value, --flag.
export function parseArgs(argv, { flags = [], aliases = {} } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s, 2);
    k = aliases[k] ?? k;
    if (flags.includes(k)) { out[k] = true; continue; }
    if (v === undefined) v = argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    out[k] = v;
  }
  return out;
}
export function die(msg, code = 1) { console.error(msg); process.exit(code); }
